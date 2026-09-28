import { html, render, $, $$, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, download } from '../lib/api.js';
import { getMasters } from '../lib/masters.js';
import { navigate, replaceQuery, openPrint } from '../lib/router.js';
import { createCombobox } from '../lib/combobox.js';
import { fmtDate, fmtTime, fmtDateTime, fmtDuration, statusBadge, STATUS_LABELS, fmtNumber, todayIso } from '../lib/format.js';
import { dataTable, pager } from '../lib/table.js';
import { emptyState, loadingBlock, toast, toastError, options, highlight, setBusy } from '../lib/ui.js';

const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['last30', 'Last 30 Days'], ['year', 'This Year'], ['custom', 'Custom Date Range'], ['all', 'All Dates']];
const COLS_KEY = 'vms.reportColumns';

function cell(col, row) {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return html`<span class="faint">—</span>`;
  switch (col.type) {
    case 'date': return html`<span class="nowrap">${fmtDate(v)}</span>`;
    case 'time': return fmtTime(v);
    case 'datetime': return html`<span class="nowrap">${fmtDateTime(v)}</span>`;
    case 'duration': return fmtDuration(v);
    case 'status': return statusBadge(v);
    case 'number': return fmtNumber(v);
    default: return String(v);
  }
}

export default async function reports(root, { params, query }) {
  const [catalogue, masters] = await Promise.all([api('/reports'), getMasters()]);
  const all = catalogue.groups.flatMap((g) => g.items);
  const def = all.find((r) => r.type === params.type) || all[0];
  if (!params.type) { navigate(`/reports/${def.type}`, { replace: true, force: true }); return; }

  let savedCols = {};
  try { savedCols = JSON.parse(localStorage.getItem(COLS_KEY) || '{}'); } catch { savedCols = {}; }
  const state = {
    period: query.get('period') || def.defaultPeriod,
    from: query.get('from') || todayIso(-30),
    to: query.get('to') || todayIso(),
    page: 1, pageSize: 25, sort: null, dir: 'desc',
    filters: {},
    visible: savedCols[def.type] || def.columns.filter((c) => c.visible !== false).map((c) => c.key),
  };
  for (const k of ['departmentId', 'hostId', 'companyId', 'categoryId', 'purposeId', 'status', 'q', 'action', 'user']) if (query.get(k)) state.filters[k] = query.get(k);
  const isAudit = def.type === 'audit';
  const isList = def.kind === 'list';

  render(root, html`
    <div class="page-header"><div><h1>Reports &amp; Analytics</h1><div class="subtitle">Server-generated reports. Exports always respect the filters shown.</div></div></div>
    <div class="reports-layout">
      <nav class="card report-nav" aria-label="Reports"><div class="card-body" style="padding:8px">
        ${catalogue.groups.map((g) => html`<h3>${g.title}</h3>${g.items.map((r) => html`<a href="/reports/${r.type}" ${r.type === def.type ? html`aria-current="page"` : ''}>${r.title}</a>`)}`)}
      </div></nav>
      <div style="min-width:0">
        <section class="card mb-2" aria-labelledby="rep-title">
          <div class="card-header">
            <div><h2 id="rep-title">${def.title}</h2><div class="hint" data-range-hint></div></div>
            <div class="row">
              ${catalogue.canExport ? html`
                <button type="button" class="btn" data-export="xlsx">${icon('sheet')}Export Excel</button>
                <button type="button" class="btn" data-export="pdf">${icon('file')}Export PDF</button>
                <button type="button" class="btn" data-export="csv">${icon('download')}CSV</button>` : ''}
              <button type="button" class="btn primary" data-print>${icon('printer')}Print</button>
            </div>
          </div>
          <form data-filters novalidate>
            <div class="filter-bar">
              ${def.ignoreDates ? '' : html`
                <div class="field"><label for="r-period">Period</label><select id="r-period" class="select">${PERIODS.map(([k, l]) => html`<option value="${k}" ${state.period === k ? 'selected' : ''}>${l}</option>`)}</select></div>
                <div class="field" data-custom ${state.period === 'custom' ? '' : 'hidden'}><label for="r-from">From Date</label><input id="r-from" type="date" class="input" value="${state.from}"></div>
                <div class="field" data-custom ${state.period === 'custom' ? '' : 'hidden'}><label for="r-to">To Date</label><input id="r-to" type="date" class="input" value="${state.to}"></div>`}
              ${isAudit ? html`
                <div class="field"><label for="r-user">User</label><input id="r-user" name="user" class="input" value="${state.filters.user || ''}"></div>
                <div class="field"><label for="r-action">Action</label><input id="r-action" name="action" class="input" placeholder="e.g. VISITOR_CHECKED_IN" value="${state.filters.action || ''}"></div>` : html`
                <div class="field"><label for="r-dept">Department</label><select id="r-dept" name="departmentId" class="select">${options(masters.departments, state.filters.departmentId, { placeholder: 'All departments' })}</select></div>
                <div class="field"><label for="r-host">Host</label><div><input id="r-host" class="input" placeholder="All hosts"></div></div>
                <div class="field"><label for="r-company">Company</label><div><input id="r-company" class="input" placeholder="All companies"></div></div>
                <div class="field"><label for="r-category">Visitor Category</label><select id="r-category" name="categoryId" class="select">${options(masters.categories, state.filters.categoryId, { placeholder: 'All categories' })}</select></div>
                <div class="field"><label for="r-purpose">Purpose</label><select id="r-purpose" name="purposeId" class="select">${options(masters.purposes, state.filters.purposeId, { placeholder: 'All purposes' })}</select></div>
                ${isList && !['on-premises', 'checked-out', 'pending-approval'].includes(def.type) ? html`<div class="field"><label for="r-status">Status</label><select id="r-status" name="status" class="select">${options(Object.entries(STATUS_LABELS).map(([id, name]) => ({ id, name })), state.filters.status, { placeholder: 'All statuses' })}</select></div>` : ''}`}
              <div class="field"><label for="r-q">Search</label><input id="r-q" name="q" type="search" class="input" placeholder="${isAudit ? 'Details or record reference' : 'Visitor, company, host, reference'}" value="${state.filters.q || ''}"></div>
            </div>
            <div class="filter-actions">
              <button type="submit" class="btn primary">${icon('search')}Search</button>
              <button type="button" class="btn" data-reset>Reset</button>
            </div>
          </form>
        </section>
        <section class="card" aria-label="Report results">
          <div class="table-toolbar">
            <div class="muted" data-count role="status"></div>
            <div class="rel">
              <button type="button" class="btn sm" data-cols aria-expanded="false" aria-haspopup="true">${icon('columns')}Columns</button>
              <div class="column-menu" data-col-menu hidden role="group" aria-label="Visible columns">
                ${def.columns.map((c) => html`<label class="checkbox"><input type="checkbox" value="${c.key}" ${state.visible.includes(c.key) ? 'checked' : ''}>${c.label}</label>`)}
              </div>
            </div>
          </div>
          <div data-table>${loadingBlock('Generating report…')}</div>
        </section>
      </div>
    </div>`);

  const form = $('[data-filters]', root);
  if (!isAudit) {
    const hostBox = createCombobox($('#r-host', root), {
      fetch: async (q, signal) => (await api('/employees', { query: { q, pageSize: 8, active: 'all' }, signal })).items,
      renderItem: (e, q) => html`<div class="opt-main">${highlight(e.displayName, q)}</div><div class="opt-sub">${e.designation}</div>`,
      itemLabel: (e) => e.displayName,
      onSelect: (e) => { if (e) state.filters.hostId = e.id; else delete state.filters.hostId; },
    });
    const companyBox = createCombobox($('#r-company', root), {
      fetch: async (q, signal) => (await api('/companies', { query: { q, compact: 'true', pageSize: 8, active: 'all' }, signal })).items,
      renderItem: (c, q) => html`<div class="opt-main">${highlight(c.name, q)}</div>`,
      itemLabel: (c) => c.name,
      onSelect: (c) => { if (c) state.filters.companyId = c.id; else delete state.filters.companyId; },
    });
    if (state.filters.hostId) api(`/employees/${state.filters.hostId}`).then((r) => hostBox.set(r.employee)).catch(() => {});
    if (state.filters.companyId) api(`/companies/${state.filters.companyId}`).then((r) => companyBox.set(r.company)).catch(() => {});
    state.boxes = { hostBox, companyBox };
  }

  function params_() {
    const p = { ...state.filters, sort: state.sort, dir: state.sort ? state.dir : undefined };
    if (!def.ignoreDates) {
      p.period = state.period;
      if (state.period === 'custom') { p.from = state.from; p.to = state.to; }
    }
    return p;
  }

  function readForm() {
    const keep = { hostId: state.filters.hostId, companyId: state.filters.companyId };
    state.filters = {};
    for (const el of form.elements) if (el.name && el.value.trim()) state.filters[el.name] = el.value.trim();
    if (keep.hostId && $('#r-host', root)?.value) state.filters.hostId = keep.hostId;
    if (keep.companyId && $('#r-company', root)?.value) state.filters.companyId = keep.companyId;
    if (!def.ignoreDates) {
      state.period = $('#r-period', root).value;
      state.from = $('#r-from', root).value;
      state.to = $('#r-to', root).value;
    }
  }

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const box = $('[data-table]', root);
    render(box, loadingBlock('Generating report…'));
    const p = params_();
    replaceQuery({ ...p, sort: null, dir: null });
    try {
      const data = await api(`/reports/${def.type}`, { query: { ...p, page: state.page, pageSize: state.pageSize } });
      if (mine !== seq) return; // superseded by a newer request
      const f = data.filters || {};
      $('[data-range-hint]', root).textContent = def.ignoreDates ? 'Live – not limited by date' : (f.from || f.to ? `${fmtDate(f.from)} to ${fmtDate(f.to)}` : 'All dates');
      $('[data-count]', root).textContent = `${fmtNumber(data.total)} ${def.kind === 'summary' ? 'groups' : 'records'}`;
      const cols = data.columns.filter((c) => state.visible.includes(c.key)).map((c) => ({
        key: c.key, label: c.label, sortable: c.sortable, num: ['number', 'duration'].includes(c.type) && def.kind !== 'list', render: (r) => cell(c, r),
      }));
      const footer = data.totals ? html`<tr>${cols.map((c, i) => html`<td class="${c.num ? 'num' : ''}">${i === 0 ? 'Total' : data.totals[c.key] !== undefined ? cell(data.columns.find((x) => x.key === c.key), data.totals) : ''}</td>`)}</tr>` : null;
      render(box, html`${dataTable({
        caption: def.title, columns: cols, rows: data.rows, sort: state.sort, dir: state.dir, footer,
        rowAttrs: (r) => (isList && r.id ? { cls: 'clickable', href: `/visits/${r.id}` } : def.type === 'repeat-visitors' ? { cls: 'clickable', href: `/visitors/${r.id}` } : {}),
        empty: emptyState('No records found', 'Try changing the report filters or the date range.', 'report'),
      })}${data.total > state.pageSize ? pager({ page: state.page, pageSize: state.pageSize, total: data.total }) : ''}`);
    } catch (err) {
      if (mine === seq) render(box, emptyState('Unable to generate the report', err.message, 'alert'));
    }
  }

  on(root, 'change', '#r-period', (e) => { $$('[data-custom]', root).forEach((x) => { x.hidden = e.target.value !== 'custom'; }); });
  form.addEventListener('submit', (e) => { e.preventDefault(); readForm(); state.page = 1; load(); });
  on(root, 'click', '[data-reset]', () => {
    form.reset();
    for (const el of form.elements) if (el.name) el.value = '';
    state.filters = {};
    state.boxes?.hostBox.clear();
    state.boxes?.companyBox.clear();
    if (!def.ignoreDates) { $('#r-period', root).value = def.defaultPeriod; $$('[data-custom]', root).forEach((x) => { x.hidden = def.defaultPeriod !== 'custom'; }); }
    state.period = def.defaultPeriod;
    state.page = 1;
    state.sort = null;
    load();
  });
  on(root, 'click', '[data-sort]', (e, b) => {
    state.dir = state.sort === b.dataset.sort && state.dir === 'desc' ? 'asc' : 'desc';
    state.sort = b.dataset.sort;
    state.page = 1;
    load();
  });
  on(root, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  on(root, 'change', '[data-page-size]', (e) => { state.pageSize = Number(e.target.value); state.page = 1; load(); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a,button')) navigate(tr.dataset.href); });
  on(root, 'click', '[data-cols]', (e, b) => {
    const menu = $('[data-col-menu]', root);
    menu.hidden = !menu.hidden;
    b.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('input')?.focus();
  });
  on(root, 'change', '[data-col-menu] input', () => {
    state.visible = $$('[data-col-menu] input:checked', root).map((i) => i.value);
    if (!state.visible.length) { state.visible = [def.columns[0].key]; }
    savedCols[def.type] = state.visible;
    try { localStorage.setItem(COLS_KEY, JSON.stringify(savedCols)); } catch { /* per-viewer convenience only */ }
    load();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('[data-col-menu]', root).hidden) { $('[data-col-menu]', root).hidden = true; $('[data-cols]', root).focus(); }
  });
  on(root, 'click', '[data-export]', async (e, b) => {
    setBusy(b, true, 'Preparing…');
    try {
      const name = await download(`/reports/${def.type}/export`, { ...params_(), format: b.dataset.export, columns: state.visible.join(',') });
      toast(`Report exported: ${name}`);
    } catch (err) { toastError(err); } finally { setBusy(b, false); }
  });
  on(root, 'click', '[data-print]', () => {
    const qs = new URLSearchParams(Object.entries({ ...params_(), columns: state.visible.join(',') }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    openPrint(`/print/report/${def.type}?${qs}`);
  });

  await load();
}
