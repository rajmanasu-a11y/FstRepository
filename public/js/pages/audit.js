import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, download } from '../lib/api.js';
import { can } from '../lib/state.js';
import { fmtDateTime, todayIso } from '../lib/format.js';
import { dataTable, pager } from '../lib/table.js';
import { emptyState, loadingBlock, toastError, options, toast } from '../lib/ui.js';

export default async function audit(root) {
  const state = { from: todayIso(-7), to: todayIso(), action: '', user: '', q: '', page: 1, pageSize: 50 };
  render(root, html`
    <div class="page-header"><div><h1>Audit Logs</h1><div class="subtitle">Append-only record of every significant action. Entries cannot be edited or deleted.</div></div>
      <div class="page-actions">${can('report.export') ? html`<button type="button" class="btn" data-export>${icon('sheet')}Export Excel</button>` : ''}<a class="btn" href="/reports/audit">${icon('report')}Audit Report</a></div></div>
    <section class="card mb-2"><form data-f novalidate><div class="filter-bar">
      <div class="field"><label for="a-from">From Date</label><input id="a-from" type="date" class="input" value="${state.from}"></div>
      <div class="field"><label for="a-to">To Date</label><input id="a-to" type="date" class="input" value="${state.to}"></div>
      <div class="field"><label for="a-user">User</label><input id="a-user" class="input" placeholder="Username"></div>
      <div class="field"><label for="a-action">Action</label><select id="a-action" class="select"><option value="">All actions</option></select></div>
      <div class="field span-2"><label for="a-q">Search details / record</label><input id="a-q" type="search" class="input" placeholder="e.g. VST-2026-000123, visitor name"></div>
    </div><div class="filter-actions"><button type="submit" class="btn primary">${icon('search')}Search</button><button type="button" class="btn" data-reset>Reset</button></div></form></section>
    <section class="card"><div data-table>${loadingBlock('Loading audit log…')}</div></section>`);

  let actionsLoaded = false;
  async function load() {
    try {
      const res = await api('/audit-logs', { query: { from: state.from, to: state.to, action: state.action, user: state.user, q: state.q, page: state.page, pageSize: state.pageSize } });
      if (!actionsLoaded) { render($('#a-action', root), options(res.actions.map((a) => ({ id: a, name: a.replace(/_/g, ' ') })), state.action, { placeholder: 'All actions' })); actionsLoaded = true; }
      render($('[data-table]', root), html`${dataTable({
        caption: 'Audit log entries',
        columns: [
          { key: 'at', label: 'Date & Time', render: (a) => html`<span class="nowrap">${fmtDateTime(a.occurredAt)}</span>` },
          { key: 'user', label: 'User', render: (a) => html`<div class="cell-main">${a.username || '—'}</div><div class="cell-sub">${a.role || ''}</div>` },
          { key: 'action', label: 'Action', render: (a) => html`<span class="tag ${/FAILED|DENIED|BLOCKED|RESTRICTED/.test(a.action) ? 'danger' : /DELETE|ARCHIV|REJECT|CANCEL/.test(a.action) ? 'warning' : 'info'}">${a.action.replace(/_/g, ' ')}</span>` },
          { key: 'record', label: 'Record', render: (a) => html`<span class="code-ref">${a.entityRef || (a.entityType ? `${a.entityType} ${a.entityId || ''}` : '—')}</span>` },
          { key: 'summary', label: 'Details', render: (a) => html`<div>${a.summary || ''}</div>${a.oldValues || a.newValues ? html`<details class="json"><summary>Previous / new values</summary><pre>${JSON.stringify({ previous: a.oldValues, new: a.newValues }, null, 2)}</pre></details>` : ''}` },
          { key: 'ip', label: 'IP / Device', render: (a) => html`<div class="mono" style="font-size:.8rem">${a.ip || '—'}</div><div class="cell-sub" title="${a.userAgent || ''}">${(a.userAgent || '').split(' ')[0]}</div>` },
        ],
        rows: res.items,
        empty: emptyState('No audit entries found', 'Try changing the date range or filters.', 'shield'),
      })}${res.total ? pager({ page: state.page, pageSize: state.pageSize, total: res.total, label: 'entries' }) : ''}`);
    } catch (err) { toastError(err); }
  }
  $('[data-f]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(state, { from: $('#a-from', root).value, to: $('#a-to', root).value, user: $('#a-user', root).value.trim(), action: $('#a-action', root).value, q: $('#a-q', root).value.trim(), page: 1 });
    load();
  });
  on(root, 'click', '[data-reset]', () => { $('[data-f]', root).reset(); Object.assign(state, { from: todayIso(-7), to: todayIso(), action: '', user: '', q: '', page: 1 }); $('#a-from', root).value = state.from; $('#a-to', root).value = state.to; load(); });
  on(root, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  on(root, 'change', '[data-page-size]', (e) => { state.pageSize = Number(e.target.value); state.page = 1; load(); });
  on(root, 'click', '[data-export]', async () => {
    try { const n = await download('/reports/audit/export', { format: 'xlsx', period: 'custom', from: state.from, to: state.to, action: state.action, user: state.user, q: state.q }); toast(`Exported ${n}`); } catch (err) { toastError(err); }
  });
  await load();
}
