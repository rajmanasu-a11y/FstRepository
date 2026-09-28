import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, session } from '../lib/state.js';
import { getMasters } from '../lib/masters.js';
import { navigate, replaceQuery } from '../lib/router.js';
import { createCombobox } from '../lib/combobox.js';
import { fmtDate, fmtTime, fmtDuration, statusBadge, STATUS_LABELS } from '../lib/format.js';
import { dataTable, pager } from '../lib/table.js';
import { emptyState, loadingBlock, toastError, options, highlight } from '../lib/ui.js';
import { photoOrInitials } from '../components/visitCard.js';

const FILTER_KEYS = ['q', 'from', 'to', 'status', 'visitorName', 'mobile', 'email', 'company', 'passNumber', 'visitCode', 'hostId', 'departmentId', 'purposeId', 'categoryId', 'visitorType', 'watchlist'];

export default async function visitors(root, { query }) {
  const masters = await getMasters();
  const isHost = !can('visit.view_all');
  const state = { page: Number(query.get('page')) || 1, pageSize: Number(query.get('pageSize')) || 25, sort: query.get('sort') || 'date', dir: query.get('dir') || 'desc', filters: {} };
  for (const k of FILTER_KEYS) if (query.get(k)) state.filters[k] = query.get(k);
  const moreOpen = ['visitorName', 'mobile', 'email', 'company', 'passNumber', 'visitCode', 'hostId', 'departmentId', 'purposeId', 'categoryId', 'visitorType'].some((k) => state.filters[k]);

  render(root, html`
    <div class="page-header">
      <div><h1>${isHost ? 'My Visitor History' : 'Visitor Search & History'}</h1><div class="subtitle">${isHost ? 'Visits where you are the host.' : 'Search every visit by visitor, organisation, host, reference numbers, dates and status.'}</div></div>
      ${can('visit.create') ? html`<div class="page-actions"><a href="/register" class="btn primary">${icon('userPlus')}Visitor Registration</a></div>` : ''}
    </div>
    <section class="card mb-2" aria-label="Search filters">
      <form data-filters novalidate>
        <div class="filter-bar">
          <div class="field span-2"><label for="f-q">Search</label><input id="f-q" name="q" class="input" type="search" placeholder="Visitor name, mobile, organisation, email, host or reference number" value="${state.filters.q || ''}"></div>
          <div class="field"><label for="f-from">From Date</label><input id="f-from" name="from" type="date" class="input" value="${state.filters.from || ''}"></div>
          <div class="field"><label for="f-to">To Date</label><input id="f-to" name="to" type="date" class="input" value="${state.filters.to || ''}"></div>
          <div class="field"><label for="f-status">Status</label><select id="f-status" name="status" class="select">${options(Object.entries(STATUS_LABELS).map(([id, name]) => ({ id, name })), state.filters.status, { placeholder: 'All statuses' })}</select></div>
          <div class="field"><label for="f-category">Visitor Category</label><select id="f-category" name="categoryId" class="select">${options(masters.categories, state.filters.categoryId, { placeholder: 'All categories' })}</select></div>
          <div class="field"><label for="f-purpose">Purpose</label><select id="f-purpose" name="purposeId" class="select">${options(masters.purposes, state.filters.purposeId, { placeholder: 'All purposes' })}</select></div>
          <div class="field"><label for="f-dept">Department</label><select id="f-dept" name="departmentId" class="select">${options(masters.departments, state.filters.departmentId, { placeholder: 'All departments' })}</select></div>
        </div>
        <div style="padding:0 18px 12px"><button type="button" class="disclosure-btn" aria-expanded="${moreOpen}" aria-controls="more-filters" data-more>${icon('chevronRight')}More search fields</button></div>
        <div class="filter-bar" id="more-filters" style="padding-top:0" ${moreOpen ? '' : 'hidden'}>
          <div class="field"><label for="f-name">Visitor Name</label><input id="f-name" name="visitorName" class="input" value="${state.filters.visitorName || ''}"></div>
          <div class="field"><label for="f-mobile">Mobile Number</label><input id="f-mobile" name="mobile" class="input mono" inputmode="numeric" value="${state.filters.mobile || ''}"></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" class="input" value="${state.filters.email || ''}"></div>
          <div class="field"><label for="f-company">Organisation / Company</label><input id="f-company" name="company" class="input" value="${state.filters.company || ''}"></div>
          <div class="field"><label for="f-pass">Visitor Pass Number</label><input id="f-pass" name="passNumber" class="input mono" placeholder="PASS-2026-000001" value="${state.filters.passNumber || ''}"></div>
          <div class="field"><label for="f-visit">Visit Reference Number</label><input id="f-visit" name="visitCode" class="input mono" placeholder="VST-2026-000001" value="${state.filters.visitCode || ''}"></div>
          ${isHost ? '' : html`<div class="field"><label for="f-host">Host</label><div><input id="f-host" class="input" placeholder="Search host"></div></div>`}
          <div class="field"><label for="f-type">Visitor Type</label><select id="f-type" name="visitorType" class="select">
            <option value="">All visitors</option><option value="FIRST_TIME" ${state.filters.visitorType === 'FIRST_TIME' ? 'selected' : ''}>First-time visitors</option><option value="REPEAT" ${state.filters.visitorType === 'REPEAT' ? 'selected' : ''}>Repeat visitors</option></select></div>
        </div>
        <div class="filter-actions">
          <button type="submit" class="btn primary">${icon('search')}Search</button>
          <button type="button" class="btn" data-reset>Reset</button>
          <span class="muted" style="font-size:.84rem" data-summary></span>
        </div>
      </form>
    </section>
    <section class="card" aria-label="Search results"><div data-results>${loadingBlock('Searching visitor records…')}</div></section>`);

  const form = $('[data-filters]', root);
  let hostId = state.filters.hostId || null;
  if (!isHost) {
    const hostBox = createCombobox($('#f-host', root), {
      fetch: async (q, signal) => (await api('/employees', { query: { q, pageSize: 8, active: 'all' }, signal })).items,
      renderItem: (e, q) => html`<div class="opt-main">${highlight(e.displayName, q)}</div><div class="opt-sub">${e.designation} · ${e.departmentName}</div>`,
      itemLabel: (e) => e.displayName,
      onSelect: (e) => { hostId = e?.id || null; },
    });
    if (hostId) api(`/employees/${hostId}`).then(({ employee }) => hostBox.set(employee)).catch(() => {});
  }

  function readFilters() {
    const f = {};
    for (const el of form.elements) if (el.name && el.value.trim()) f[el.name] = el.value.trim();
    if (hostId) f.hostId = hostId;
    if (state.filters.watchlist) f.watchlist = state.filters.watchlist;
    return f;
  }

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const box = $('[data-results]', root);
    render(box, loadingBlock('Searching visitor records…'));
    replaceQuery({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, state.filters[k]])), page: state.page > 1 ? state.page : null, sort: state.sort !== 'date' ? state.sort : null, dir: state.dir !== 'desc' ? state.dir : null });
    try {
      const res = await api('/visits', { query: { ...state.filters, page: state.page, pageSize: state.pageSize, sort: state.sort, dir: state.dir } });
      if (mine !== seq) return; // a newer search has been started
      const n = Object.keys(state.filters).length;
      $('[data-summary]', root).textContent = n ? `${n} filter${n === 1 ? '' : 's'} applied` : 'Showing all visits, most recent first';
      render(box, html`${dataTable({
        caption: 'Visitor search results',
        sort: state.sort, dir: state.dir,
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (v) => html`<span class="nowrap">${fmtDate(v.appointmentDate)}</span>` },
          { key: 'visitor', label: 'Visitor', sortable: true, render: (v) => html`<div class="person">${photoOrInitials(v)}<div><a class="cell-main" href="/visits/${v.id}">${v.visitor.fullName}</a><div class="cell-sub mono">${v.visitCode}</div></div></div>` },
          { key: 'company', label: 'Company', sortable: true, render: (v) => v.companyName || html`<span class="faint">—</span>` },
          { key: 'host', label: 'Host', sortable: true, render: (v) => html`<div>${v.host.name}</div><div class="cell-sub">${v.departmentName}</div>` },
          { key: 'purpose', label: 'Purpose', sortable: true, render: (v) => v.purpose },
          { key: 'checkIn', label: 'Check-In', sortable: true, render: (v) => fmtTime(v.checkInAt) || html`<span class="faint">—</span>` },
          { key: 'checkOut', label: 'Check-Out', sortable: true, render: (v) => (v.checkOutAt ? html`${fmtTime(v.checkOutAt)}<div class="cell-sub">${fmtDuration(v.durationMinutes)} hrs</div>` : html`<span class="faint">—</span>`) },
          { key: 'status', label: 'Status', sortable: true, render: (v) => statusBadge(v.status) },
        ],
        rows: res.items,
        rowAttrs: (v) => ({ cls: 'clickable', href: `/visits/${v.id}` }),
        empty: emptyState('No visitors found', 'Try changing the search criteria or date range.', 'search'),
      })}${res.total ? pager({ page: state.page, pageSize: state.pageSize, total: res.total, label: 'visits' }) : ''}`);
    } catch (err) {
      if (mine === seq) render(box, emptyState('Unable to search visitor records', err.message, 'alert'));
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); state.filters = readFilters(); state.page = 1; load(); });
  on(root, 'click', '[data-reset]', () => {
    form.reset();
    for (const el of form.elements) if (el.name) el.value = '';
    hostId = null;
    const h = $('#f-host', root); if (h) h.value = '';
    state.filters = {};
    state.page = 1;
    load();
    $('#f-q', root).focus();
  });
  on(root, 'click', '[data-more]', (e, b) => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); $('#more-filters', root).hidden = !open; });
  on(root, 'click', '[data-sort]', (e, b) => {
    const key = b.dataset.sort;
    state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
    state.sort = key;
    load();
  });
  on(root, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); $('[data-results]', root).scrollIntoView({ block: 'start' }); });
  on(root, 'change', '[data-page-size]', (e) => { state.pageSize = Number(e.target.value); state.page = 1; load(); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a,button')) navigate(tr.dataset.href); });

  await load();
  $('#f-q', root).focus();
}
