import { html, render, uid, debounce } from './dom.js';

/**
 * Accessible asynchronous combobox (WAI-ARIA 1.2 "list autocomplete").
 *
 *  - Suggestions are fetched from the server (debounced, previous request aborted).
 *  - ArrowDown / ArrowUp move through options, Enter selects, Escape closes,
 *    Tab selects the option the user has navigated to and moves on.
 *  - The listbox is never a tab stop; focus always stays in the input.
 *
 * options:
 *   fetch(query, signal) -> Promise<items[]>
 *   renderItem(item, query) -> SafeHtml
 *   itemLabel(item) -> string shown in the input after selection
 *   onSelect(item | null)
 *   createOption(query) -> { label, item } | null   (e.g. "+ Add New Company")
 *   minChars, emptyText, loadingText
 */
export function createCombobox(input, opts) {
  const {
    fetch: fetchItems, renderItem, itemLabel, onSelect, createOption,
    minChars = 1, emptyText = 'No matching records found', loadingText = 'Searching…', delay = 200,
  } = opts;
  const listId = uid('listbox');
  const wrapper = input.parentElement;
  wrapper.classList.add('combo');
  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'combo-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrapper.appendChild(list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('autocomplete', 'off');

  let items = [];
  let active = -1;
  let userNavigated = false;
  let selected = null;
  let controller = null;
  let lastQuery = '';

  const optionId = (i) => `${listId}-opt-${i}`;

  function open() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    userNavigated = false;
  }
  function setActive(i) {
    active = i;
    [...list.querySelectorAll('[role="option"]')].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', optionId(i));
      document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function renderStatus(text, spinner = false) {
    render(list, html`<li class="status-row" role="presentation">${spinner ? html`<span class="spinner sm" aria-hidden="true"></span>` : ''}${text}</li>`);
    open();
  }
  function renderList(query) {
    const create = createOption?.(query, items);
    const all = create ? [...items, { __create: true, ...create }] : items;
    if (!all.length) { renderStatus(emptyText); items = []; return; }
    items = all;
    render(list, html`${all.map((item, i) => html`
      <li id="${optionId(i)}" role="option" aria-selected="false" data-index="${i}" class="${item.__create ? 'create-row' : ''}">
        ${item.__create ? item.label : renderItem(item, query)}
      </li>`)}`);
    open();
    setActive(0);
    userNavigated = false;
  }

  const search = debounce(async (query) => {
    controller?.abort();
    controller = new AbortController();
    lastQuery = query;
    renderStatus(loadingText, true);
    try {
      const result = await fetchItems(query, controller.signal);
      if (query !== lastQuery || document.activeElement !== input) { if (document.activeElement !== input) close(); return; }
      items = result;
      renderList(query);
    } catch (err) {
      if (err.name === 'AbortError') return;
      renderStatus('Unable to load suggestions. Please try again.');
    }
  }, delay);

  function choose(i) {
    const item = items[i];
    if (!item) return;
    const value = item.__create ? item.item : item;
    selected = value;
    input.value = item.__create ? (item.inputValue ?? input.value) : itemLabel(value);
    close();
    onSelect?.(value);
  }

  input.addEventListener('input', () => {
    if (selected) { selected = null; onSelect?.(null); }
    const q = input.value.trim();
    if (q.length < minChars) { search.cancel(); close(); return; }
    search(q);
  });
  input.addEventListener('keydown', (e) => {
    const isOpen = !list.hidden && items.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        const q = input.value.trim();
        if (q.length >= minChars || minChars === 0) search(q);
        return;
      }
      // The first suggestion is pre-highlighted; the first ArrowDown confirms it.
      if (!userNavigated) { userNavigated = true; setActive(Math.max(active, 0)); return; }
      setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) return;
      e.preventDefault();
      userNavigated = true;
      setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      if (isOpen && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Tab') {
      if (isOpen && active >= 0 && (userNavigated || items.length === 1 || (items[active] && !items[active].__create && itemLabel(items[active]).toLowerCase() === input.value.trim().toLowerCase()))) {
        choose(active);
      } else {
        close();
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.index));
  });

  return {
    get value() { return selected; },
    set(item, label) {
      selected = item;
      input.value = item ? (label ?? itemLabel(item)) : '';
      close();
    },
    clear() { selected = null; input.value = ''; close(); },
    close,
    destroy() { search.cancel(); controller?.abort(); list.remove(); },
  };
}
