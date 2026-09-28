import { html, render, $, on, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { dataTable, pager } from '../lib/table.js';
import { emptyState, loadingBlock, toast, toastError, modal, field, showFieldErrors, clearErrors, setBusy, confirmDialog } from '../lib/ui.js';

const IDS = { name: 'c-name', address: 'c-address', contactPerson: 'c-person', contactNumber: 'c-phone', email: 'c-email', website: 'c-web', category: 'c-cat' };
const CATEGORIES = ['IT Services', 'Consulting', 'Engineering', 'Facility Management', 'Legal', 'Logistics', 'Vendor', 'Contractor', 'Audit', 'Courier', 'Government', 'Education', 'Other'];

export default async function companies(root) {
  const state = { q: '', active: 'true', page: 1, pageSize: 25, items: [] };
  render(root, html`
    <div class="page-header"><div><h1>Organisation / Company Directory</h1><div class="subtitle">Organisations offered through autocomplete during visitor registration.</div></div>
      <div class="page-actions"><button type="button" class="btn primary" data-add>${icon('plus')}Add Organisation</button></div></div>
    <section class="card">
      <div class="table-toolbar"><div class="row">
        <label for="c-q" class="sr-only">Search organisations</label><input id="c-q" type="search" class="input" style="width:320px" placeholder="Search organisation name">
        <label for="c-factive" class="sr-only">Status</label><select id="c-factive" class="select" style="width:150px"><option value="true">Active</option><option value="false">Inactive</option><option value="all">All</option></select>
      </div><span class="muted" data-count></span></div>
      <div data-table>${loadingBlock('Loading organisations…')}</div>
    </section>`);

  async function load() {
    try {
      const res = await api('/companies', { query: { q: state.q, active: state.active, page: state.page, pageSize: state.pageSize } });
      state.items = res.items;
      $('[data-count]', root).textContent = `${res.total} organisations`;
      render($('[data-table]', root), html`${dataTable({
        caption: 'Organisations',
        columns: [
          { key: 'name', label: 'Company Name', render: (c) => html`<div class="cell-main">${c.name}</div>${c.address ? html`<div class="cell-sub">${c.address}</div>` : ''}${!c.isActive ? html`<span class="tag">Inactive</span>` : ''}` },
          { key: 'cat', label: 'Category', render: (c) => c.category || '—' },
          { key: 'contact', label: 'Contact Person', render: (c) => html`<div>${c.contactPerson || '—'}</div><div class="cell-sub">${c.contactNumber || ''}</div>` },
          { key: 'email', label: 'Email / Website', render: (c) => html`<div>${c.email || '—'}</div><div class="cell-sub">${c.website || ''}</div>` },
          { key: 'visitors', label: 'Visitors', num: true, render: (c) => c.visitorCount },
          { key: 'visits', label: 'Visits', num: true, render: (c) => c.visitCount },
          { key: 'last', label: 'Last Visit', render: (c) => (c.lastVisitAt ? fmtDate(c.lastVisitAt) : '—') },
          { key: 'act', label: html`<span class="sr-only">Actions</span>`, render: (c) => html`<button type="button" class="btn sm" data-edit="${c.id}" aria-label="Edit ${c.name}">${icon('edit')}Edit</button>` },
        ],
        rows: res.items,
        empty: emptyState('No organisations found', 'Try changing the search or add a new organisation.', 'building'),
      })}${res.total > state.pageSize ? pager({ ...state, total: res.total, label: 'organisations' }) : ''}`);
    } catch (err) { toastError(err); }
  }

  function editDialog(c) {
    const m = modal({
      title: c ? 'Edit Organisation' : 'Add Organisation',
      size: 'wide',
      body: html`<form data-cf novalidate><div class="grid cols-2">
        ${field({ id: 'c-name', label: 'Company Name', required: true, cls: 'span-2', control: html`<input id="c-name" name="name" class="input" maxlength="150" value="${c?.name || ''}" aria-describedby="c-name-error">` })}
        ${field({ id: 'c-address', label: 'Address', cls: 'span-2', control: html`<input id="c-address" name="address" class="input" maxlength="300" value="${c?.address || ''}">` })}
        ${field({ id: 'c-person', label: 'Contact Person', control: html`<input id="c-person" name="contactPerson" class="input" maxlength="100" value="${c?.contactPerson || ''}">` })}
        ${field({ id: 'c-phone', label: 'Contact Number', control: html`<input id="c-phone" name="contactNumber" class="input mono" maxlength="20" value="${c?.contactNumber || ''}" aria-describedby="c-phone-error">` })}
        ${field({ id: 'c-email', label: 'Email', control: html`<input id="c-email" name="email" type="email" class="input" maxlength="254" value="${c?.email || ''}" aria-describedby="c-email-error">` })}
        ${field({ id: 'c-web', label: 'Website', control: html`<input id="c-web" name="website" class="input" maxlength="200" value="${c?.website || ''}" aria-describedby="c-web-error">` })}
        ${field({ id: 'c-cat', label: 'Category', control: html`<input id="c-cat" name="category" class="input" list="c-cats" maxlength="60" value="${c?.category || ''}"><datalist id="c-cats">${CATEGORIES.map((x) => html`<option value="${x}"></option>`)}</datalist>` })}
        <div class="field" style="justify-content:flex-end"><label class="checkbox" for="c-active"><input type="checkbox" id="c-active" name="isActive" ${!c || c.isActive ? 'checked' : ''}>Active</label></div>
      </div></form>`,
      footer: html`${c ? html`<button type="button" class="btn danger-outline" data-remove style="margin-right:auto">${icon('trash')}Archive</button>` : ''}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-save>Save</button>`,
    });
    const f = m.el.querySelector('[data-cf]');
    m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
      clearErrors(f);
      const body = { name: f.name.value, address: f.address.value, contactPerson: f.contactPerson.value, contactNumber: f.contactNumber.value, email: f.email.value, website: f.website.value, category: f.category.value, isActive: f.isActive.checked };
      setBusy(e.currentTarget, true, 'Saving…');
      try {
        const r = await api(c ? `/companies/${c.id}` : '/companies', { method: c ? 'PUT' : 'POST', body });
        toast(r.message); m.close(); load();
      } catch (err) {
        setBusy(e.currentTarget, false);
        if (err.fields) { const u = showFieldErrors(f, err.fields, IDS); if (u.length) toast(u[0], 'error'); } else toastError(err);
      }
    });
    m.el.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Archive organisation', message: `Archive ${c.name}? It will no longer be offered during registration. Existing visitor records are kept.`, confirmLabel: 'Archive', danger: true }))) return;
      try { const r = await api(`/companies/${c.id}`, { method: 'DELETE' }); toast(r.message); m.close(); load(); } catch (err) { toastError(err); }
    });
  }

  const reload = debounce(() => { state.page = 1; load(); }, 250);
  on(root, 'input', '#c-q', (e) => { state.q = e.target.value.trim(); reload(); });
  on(root, 'change', '#c-factive', (e) => { state.active = e.target.value; state.page = 1; load(); });
  on(root, 'click', '[data-add]', () => editDialog(null));
  on(root, 'click', '[data-edit]', (e, b) => editDialog(state.items.find((x) => x.id === Number(b.dataset.edit))));
  on(root, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  on(root, 'change', '[data-page-size]', (e) => { state.pageSize = Number(e.target.value); state.page = 1; load(); });
  await load();
  $('#c-q', root).focus();
}
