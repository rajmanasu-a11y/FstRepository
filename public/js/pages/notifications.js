import { html, render, $, on } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { canAny } from '../lib/state.js';
import { fmtDateTime } from '../lib/format.js';
import { emptyState, loadingBlock, toastError } from '../lib/ui.js';
import { refreshCount } from '../components/shell.js';

export default async function notifications(root) {
  render(root, html`<div class="page-header"><div><h1>Notifications</h1><div class="subtitle">Visitor arrivals, approval requests, overstay and security alerts.</div></div>
    <div class="page-actions"><button type="button" class="btn" data-read-all>Mark all as read</button></div></div>
    <section class="card" data-list>${loadingBlock('Loading notifications…')}</section>`);
  async function load() {
    try {
      const { items } = await api('/notifications');
      render($('[data-list]', root), items.length ? html`${items.map((n) => html`<div class="notif-item ${n.readAt ? '' : 'unread'}" style="padding:14px 18px">
        <div class="row between"><span class="n-title">${n.title}</span><span class="n-time">${fmtDateTime(n.createdAt)}</span></div>
        <div class="n-body">${n.body}</div>
        ${n.visitId && canAny('visit.view_all', 'visit.view_own') ? html`<div class="mt-1"><a href="/visits/${n.visitId}">View visit ${n.visitCode || ''}</a></div>` : ''}
      </div>`)}` : emptyState('No notifications', 'You have no notifications yet.', 'bell'));
    } catch (err) { toastError(err); }
  }
  on(root, 'click', '[data-read-all]', async () => { await api('/notifications/read-all', { method: 'POST' }); refreshCount(); load(); });
  await load();
}
