import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can } from '../lib/state.js';
import { fmtDate, fmtTime, fmtDateTime, statusBadge } from '../lib/format.js';
import { emptyState, loadingBlock, toast, toastError, promptDialog } from '../lib/ui.js';
import { photoOrInitials, watchlistAlert } from '../components/visitCard.js';

export default async function approvals(root) {
  let tab = 'PENDING';
  render(root, html`
    <div class="page-header"><div><h1>Visitor Approvals</h1><div class="subtitle">${can('visit.approve_any') ? 'All visit requests awaiting a host decision.' : 'Visitors who have asked to meet you.'}</div></div></div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="true" data-tab="PENDING">Pending Approval</button>
      <button type="button" role="tab" aria-selected="false" data-tab="DECIDED">Decided</button>
    </div>
    <div data-list>${loadingBlock()}</div>`);

  async function load() {
    const box = $('[data-list]', root);
    render(box, loadingBlock('Loading visit requests…'));
    try {
      const { items } = await api('/approvals', { query: { status: tab } });
      render(box, items.length ? html`<div class="stack">${items.map((v) => html`
        <article class="card"><div class="card-body" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center">
          ${photoOrInitials(v)}
          <div style="min-width:0">
            <div class="row"><a class="strong" href="/visits/${v.id}">${v.visitor.fullName}</a> ${statusBadge(v.status)} <span class="code-ref">${v.visitCode}</span></div>
            <div class="muted">${v.companyName || 'Individual'} · ${v.purpose} · ${fmtDate(v.appointmentDate)}${v.expectedArrival ? ` at ${fmtTime(v.expectedArrival)}` : ''}</div>
            <div class="cell-sub">Host: ${v.host.name} · ${v.departmentName}${v.accessAreaName ? ` · Access: ${v.accessAreaName}` : ''} · Requested ${fmtDateTime(v.createdAt)}</div>
            ${watchlistAlert(v)}
          </div>
          ${tab === 'PENDING' ? html`<div class="row"><button type="button" class="btn success" data-approve="${v.id}">${icon('check')}Approve</button><button type="button" class="btn danger-outline" data-reject="${v.id}">${icon('x')}Reject</button></div>` : ''}
        </div></article>`)}</div>`
        : html`<div class="card">${emptyState(tab === 'PENDING' ? 'No pending approvals' : 'No decided requests', tab === 'PENDING' ? 'You will be notified when a visitor requests to meet you.' : '', 'userCheck')}</div>`);
    } catch (err) { toastError(err); }
  }
  on(root, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
    load();
  });
  on(root, 'click', '[data-approve]', async (e, b) => {
    try { const r = await api(`/visits/${b.dataset.approve}/decision`, { method: 'POST', body: { decision: 'APPROVE' } }); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-reject]', async (e, b) => {
    const reason = await promptDialog({ title: 'Reject visit request', label: 'Reason for rejection', help: 'The reception desk will see this reason.', confirmLabel: 'Reject Visit', danger: true });
    if (!reason) return;
    try { const r = await api(`/visits/${b.dataset.reject}/decision`, { method: 'POST', body: { decision: 'REJECT', remarks: reason } }); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  await load();
}
