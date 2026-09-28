import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can } from '../lib/state.js';
import { navigate } from '../lib/router.js';
import { fmtTime, fmtDateTime, fmtDurationWords } from '../lib/format.js';
import { alertBox, emptyState, loadingBlock } from '../lib/ui.js';
import { visitSummary } from '../components/visitCard.js';

export default async function verify(root, { params }) {
  render(root, html`
    <div class="page-header"><div><h1>Verify Visitor Pass</h1><div class="subtitle">Scan the QR code on the visitor pass or invitation, or enter the Visitor Pass Number.</div></div></div>
    <div class="desk">
      <section class="card"><div class="card-body">
        <form data-verify novalidate class="stack">
          <div class="field"><label for="vf-q">QR code / Visitor Pass Number / Visit Reference Number</label>
            <input id="vf-q" class="input lg mono" autocomplete="off" placeholder="Scan now or type PASS-2026-000123" value="${params.token || ''}"></div>
          <button type="submit" class="btn primary lg">${icon('shieldCheck')}Verify</button>
        </form>
      </div></section>
      <section class="card visit-card" data-result aria-live="polite">${emptyState('Awaiting scan', 'The verification result will appear here.', 'qr')}</section>
    </div>`);
  const input = $('#vf-q', root);
  const out = $('[data-result]', root);

  async function check(raw) {
    const s = raw.trim();
    const token = s.match(/verify\/([A-Za-z0-9_-]{20,64})/)?.[1] || s.toUpperCase().match(/^(PASS|VST)-\d{4}-\d{6}$/)?.[0] || (/^[A-Za-z0-9_-]{20,64}$/.test(s) ? s : null);
    if (!token) { render(out, html`<div class="card-body">${alertBox('warning', 'Not recognised', 'Enter a valid Visitor Pass Number (e.g. PASS-2026-000123) or scan the QR code.')}</div>`); return; }
    render(out, loadingBlock('Verifying…'));
    try {
      const { visit: v, verdict, checkedAt } = await api(`/verify/${encodeURIComponent(token)}`);
      const type = verdict.level === 'success' ? 'success' : verdict.level === 'info' ? 'info' : verdict.level === 'warning' ? 'warning' : 'danger';
      render(out, html`
        <div class="card-body">${alertBox(type, verdict.valid ? 'VALID PASS' : 'NOT VALID FOR ENTRY', html`${verdict.message}`)}</div>
        ${visitSummary(v)}
        <div class="card-body" style="padding-top:0">
          <dl class="kv">
            <dt>Visitor Pass Number</dt><dd class="mono">${v.pass?.passNumber || '—'}</dd>
            <dt>Check-In</dt><dd>${v.checkInAt ? fmtDateTime(v.checkInAt) : '—'}</dd>
            <dt>Valid Until</dt><dd>${v.validUntil ? fmtTime(v.validUntil) : '—'}</dd>
            ${v.checkInAt && !v.checkOutAt ? html`<dt>Time on premises</dt><dd>${fmtDurationWords(v.elapsedMinutes)}</dd>` : ''}
            <dt>Access Area</dt><dd>${v.accessAreaName || '—'}</dd>
            <dt>Verified at</dt><dd>${fmtDateTime(checkedAt)}</dd>
          </dl>
          <div class="row mt-2">
            ${can('visit.checkout') && ['CHECKED_IN', 'OVERSTAY'].includes(v.status) ? html`<a class="btn" href="/check-out?q=${v.pass?.passNumber || v.visitCode}">${icon('logOut')}Check Out</a>` : ''}
            ${can('visit.checkin') && ['EXPECTED', 'APPROVED'].includes(v.status) ? html`<a class="btn" href="/check-in?q=${v.visitCode}">${icon('logIn')}Check In</a>` : ''}
            <button type="button" class="btn ghost" data-again>Verify another</button>
          </div>
        </div>`);
    } catch (err) {
      render(out, html`<div class="card-body">${alertBox('danger', 'NOT RECOGNISED', html`${err.message}`)}</div>`);
    }
    input.select();
  }
  $('[data-verify]', root).addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
  on(out, 'click', '[data-again]', () => { input.value = ''; input.focus(); if (params.token) navigate('/verify', { replace: true }); });
  input.focus();
  if (params.token) check(params.token);
}
