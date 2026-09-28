import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can } from '../lib/state.js';
import { navigate, openPrint } from '../lib/router.js';
import { fmtTime, fmtDuration, fmtDateTime, statusBadge, fmtNumber } from '../lib/format.js';
import { dataTable } from '../lib/table.js';
import { emptyState, loadingBlock, toastError, confirmDialog, toast } from '../lib/ui.js';
import { photoOrInitials } from '../components/visitCard.js';

export default async function onPremises(root) {
  let items = [];
  let filter = '';
  render(root, html`
    <div class="page-header">
      <div><h1>Visitors Currently On Premises</h1><div class="subtitle" data-updated>Live list · refreshes every minute</div></div>
      <div class="page-actions">
        ${can('emergency.view') ? html`<a class="btn" href="/emergency">${icon('siren')}Emergency Roll Call</a>` : ''}
        <button type="button" class="btn primary lg" data-print>${icon('printer')}PRINT CURRENT ON-PREMISES LIST</button>
      </div>
    </div>
    <section class="card">
      <div class="table-toolbar">
        <div class="row">
          <span class="pill-count" data-total>0</span><b>visitors inside</b><span class="muted" data-overstay></span>
        </div>
        <div class="row">
          <label for="op-filter" class="sr-only">Filter list</label>
          <input id="op-filter" class="input" type="search" placeholder="Filter by name, company, host, pass no." style="width:300px">
          <button type="button" class="btn" data-refresh>${icon('refresh')}Refresh</button>
        </div>
      </div>
      <div data-table>${loadingBlock('Loading visitors on premises…')}</div>
    </section>`);

  function draw() {
    const f = filter.toLowerCase();
    const rows = items.filter((v) => !f || [v.visitor.fullName, v.companyName, v.host.name, v.pass?.passNumber, v.departmentName].some((x) => (x || '').toLowerCase().includes(f)));
    $('[data-total]', root).textContent = fmtNumber(items.length);
    const over = items.filter((v) => v.status === 'OVERSTAY').length;
    $('[data-overstay]', root).textContent = over ? `· ${over} overstay` : '';
    render($('[data-table]', root), dataTable({
      caption: 'Visitors currently on premises',
      columns: [
        { key: 'pass', label: 'Pass No.', render: (v) => html`<span class="code-ref">${v.pass?.passNumber || '—'}</span>` },
        { key: 'visitor', label: 'Visitor Name', render: (v) => html`<div class="person">${photoOrInitials(v)}<div><a class="cell-main" href="/visits/${v.id}">${v.visitor.fullName}</a>${v.visitor.watchlistStatus !== 'NONE' ? html` <span class="tag danger">${v.visitor.watchlistStatus === 'BLOCKED' ? 'Restricted' : 'Flagged'}</span>` : ''}</div></div>` },
        { key: 'company', label: 'Company', render: (v) => v.companyName || html`<span class="faint">—</span>` },
        { key: 'host', label: 'Host', render: (v) => html`<div>${v.host.name}</div><div class="cell-sub">${v.host.designation}</div>` },
        { key: 'dept', label: 'Department', render: (v) => v.departmentName },
        { key: 'purpose', label: 'Purpose', render: (v) => v.purpose },
        { key: 'in', label: 'Check-In Time', render: (v) => fmtTime(v.checkInAt) },
        { key: 'dur', label: 'Duration', render: (v) => html`<span class="${v.status === 'OVERSTAY' ? 'strong' : ''}" style="${v.status === 'OVERSTAY' ? 'color:#b54708' : ''}">${fmtDuration(v.elapsedMinutes)}</span>` },
        { key: 'area', label: 'Access Area', render: (v) => v.accessAreaName || html`<span class="faint">—</span>` },
        { key: 'status', label: 'Status', render: (v) => statusBadge(v.status) },
        ...(can('visit.checkout') ? [{ key: 'act', label: html`<span class="sr-only">Actions</span>`, render: (v) => html`<button type="button" class="btn sm" data-checkout="${v.id}" aria-label="Check out ${v.visitor.fullName}">${icon('logOut')}Check Out</button>` }] : []),
      ],
      rows,
      rowAttrs: (v) => ({ cls: v.status === 'OVERSTAY' ? 'row-alert' : '' }),
      empty: emptyState(filter ? 'No visitors found' : 'No visitors are currently on premises', filter ? 'Try changing the filter.' : 'Checked-in visitors will appear here.', 'mapPin'),
    }));
  }

  async function load() {
    try {
      const res = await api('/visits/current');
      items = res.items;
      $('[data-updated]', root).textContent = `Live list · updated ${fmtDateTime(res.generatedAt)} · refreshes every minute`;
      draw();
    } catch (err) { toastError(err); }
  }
  on(root, 'input', '#op-filter', (e) => { filter = e.target.value.trim(); draw(); });
  on(root, 'click', '[data-refresh]', load);
  on(root, 'click', '[data-print]', () => openPrint('/print/report/on-premises'));
  on(root, 'click', '[data-checkout]', async (e, b) => {
    const v = items.find((x) => x.id === Number(b.dataset.checkout));
    const ok = await confirmDialog({ title: 'Confirm check-out', message: `Record the departure of ${v.visitor.fullName} (${v.pass?.passNumber || v.visitCode}) now?`, confirmLabel: 'Check Out' });
    if (!ok) return;
    try {
      const res = await api(`/visits/${v.id}/check-out`, { method: 'POST', body: {} });
      toast(`${res.message} Duration ${fmtDuration(res.visit.durationMinutes)}.`);
      load();
    } catch (err) { toastError(err); }
  });
  await load();
  const t = setInterval(load, 60_000);
  return () => clearInterval(t);
}
