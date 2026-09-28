import { html, render, $, $$, on, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, session } from '../lib/state.js';
import { getMasters } from '../lib/masters.js';
import { openPrint } from '../lib/router.js';
import { fmtTime, fmtDate, fmtDurationWords, fmtNumber } from '../lib/format.js';
import { emptyState, loadingBlock, toast, toastError, setBusy, alertBox, options, promptDialog } from '../lib/ui.js';
import { lookupItem, visitSummary, watchlistAlert, appointmentNote } from '../components/visitCard.js';

export default async function checkin(root, { query }) {
  const masters = await getMasters();
  const req = session.settings.visitor?.requiredFields || {};
  let items = [];
  let selected = null;

  render(root, html`
    <div class="page-header">
      <div><h1>Visitor Check-In</h1><div class="subtitle">Expected, approved and pre-registered visitors. Scan the visitor's QR code or search below.</div></div>
      <div class="page-actions"><a class="btn" href="/register">${icon('userPlus')}New Walk-in Visitor</a></div>
    </div>
    <div class="desk">
      <section class="card" aria-labelledby="ci-list-title">
        <div class="card-header" style="display:block">
          <h2 id="ci-list-title" class="sr-only">Find visitor</h2>
          <form role="search" data-search novalidate class="search-field">
            ${icon('search', 'lead')}
            <label for="ci-q" class="sr-only">Search visitor</label>
            <input id="ci-q" class="input lg" type="search" autocomplete="off" placeholder="Name / Mobile / Visit Reference / Pass No. / scan QR code" value="${query.get('q') || ''}">
          </form>
          <div class="muted mt-1" style="font-size:.84rem" data-count role="status"></div>
        </div>
        <div class="lookup-list" data-list>${loadingBlock('Loading expected visitors…')}</div>
      </section>
      <section class="card visit-card" aria-live="polite" aria-labelledby="ci-detail-title" data-detail>
        <div class="card-header"><h2 id="ci-detail-title">Visitor Details</h2></div>
        ${emptyState('Select a visitor', 'Choose a visitor from the list, or scan a QR code, to verify details and check in.', 'logIn')}
      </section>
    </div>`);

  const input = $('#ci-q', root);
  const list = $('[data-list]', root);
  const detail = $('[data-detail]', root);

  async function load(auto = false) {
    const q = input.value.trim();
    try {
      const res = await api('/visits/lookup', { query: { mode: 'checkin', q } });
      items = res.items;
      $('[data-count]', root).textContent = q ? `${fmtNumber(items.length)} matching visit${items.length === 1 ? '' : 's'}` : `${fmtNumber(items.length)} expected / awaiting check-in`;
      render(list, items.length
        ? html`${items.map((v) => lookupItem(v, { mode: 'checkin', current: selected?.id === v.id }))}`
        : emptyState(q ? 'No expected visitor found' : 'No visitors awaiting check-in', q ? 'Try the mobile number or Visit Reference Number, or register a walk-in visitor.' : 'Pre-registered and approved visitors will appear here.', 'users'));
      if (auto && q && items.length === 1) select(items[0].id);
    } catch (err) { toastError(err); }
  }

  function select(id) {
    selected = items.find((v) => v.id === Number(id));
    if (!selected) return;
    $$('.lookup-item', list).forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.visit) === selected.id)));
    renderDetail();
  }

  function renderDetail(result) {
    const v = selected;
    if (result) {
      render(detail, html`
        <div class="card-header"><h2 id="ci-detail-title">Check-In Complete</h2></div>
        ${visitSummary(result)}
        <div class="card-body" style="padding-top:0">
          ${alertBox('success', 'Visitor successfully checked in.', html`Visitor Pass Number <b class="mono">${result.pass?.passNumber}</b> · Arrival ${fmtTime(result.checkInAt)} · Valid until ${fmtTime(result.validUntil)}. The host has been notified.`)}
          <div class="stack mt-2">
            <button type="button" class="btn primary lg" data-print-pass>${icon('printer')}PRINT VISITOR PASS</button>
            <button type="button" class="btn lg" data-print-record>${icon('report')}Print Visitor Record (Half-A4)</button>
            <button type="button" class="btn ghost" data-next>Next visitor</button>
          </div>
        </div>`);
      $('[data-print-pass]', detail).focus();
      return;
    }
    const cat = masters.categories.find((c) => c.id === v.categoryId);
    const needsId = cat?.requiresId && !v.idVerified;
    const blocked = v.visitor.watchlistStatus === 'BLOCKED';
    const pending = v.status === 'PENDING_APPROVAL';
    render(detail, html`
      <div class="card-header"><h2 id="ci-detail-title">Visitor Check-In</h2><span class="muted" style="font-size:.85rem">${appointmentNote(v)}</span></div>
      ${visitSummary(v)}
      <form class="card-body" style="padding-top:0" data-ci-form novalidate>
        ${watchlistAlert(v)}
        ${pending ? html`<div class="mb-1">${alertBox('warning', 'Awaiting host approval', html`${v.host.name} has not yet approved this visit. The visitor cannot be checked in until approval is given.`)}</div>` : ''}
        ${v.specialInstructions ? html`<div class="mb-1">${alertBox('info', 'Special instructions', html`${v.specialInstructions}`)}</div>` : ''}
        <div class="stack">
          ${!v.consentGiven ? html`<div class="field">
            <label class="checkbox box" for="ci-consent"><input type="checkbox" id="ci-consent" aria-describedby="ci-consent-error"><span><b>Visitor declaration accepted</b>${req.declaration ? html`<span class="req">*</span>` : ''}<br><span class="muted" style="font-size:.84rem">${session.settings.visitor?.declarationText || ''}</span></span></label>
            <div class="error-text" id="ci-consent-error" role="alert"></div></div>` : html`<div class="tag success">${icon('check')}Declaration accepted ${v.consentAt ? fmtTime(v.consentAt) : ''}</div>`}
          ${!v.idVerified ? html`<div class="field">
            <label class="checkbox box" for="ci-id"><input type="checkbox" id="ci-id" aria-describedby="ci-id-error"><span><b>ID verified</b>${needsId ? html`<span class="req">*</span> <span class="muted">(required for ${cat.name})</span>` : ''}${v.visitor.idTypeName ? html`<br><span class="muted" style="font-size:.84rem">${v.visitor.idTypeName} ${v.visitor.idReference || ''}</span>` : ''}</span></label>
            <div class="error-text" id="ci-id-error" role="alert"></div></div>` : html`<div class="tag success">${icon('check')}ID verified</div>`}
          <div class="field">
            <label for="ci-area">Access Area</label>
            <select id="ci-area" class="select">${options(masters.accessAreas, v.accessAreaId, { placeholder: 'Not specified' })}</select>
          </div>
        </div>
        <div class="row mt-2">
          <button type="submit" class="btn success lg" data-do-checkin ${blocked || pending ? 'disabled' : ''}>${icon('logIn')}CHECK IN</button>
          ${pending && can('visit.approve_any') ? html`<button type="button" class="btn lg" data-approve>${icon('userCheck')}Approve Visit</button>` : ''}
          <button type="button" class="btn lg ghost" data-cancel-select>Cancel</button>
        </div>
      </form>`);
    const first = $('#ci-consent', detail) || $('#ci-id', detail) || $('[data-do-checkin]:not([disabled])', detail) || $('[data-cancel-select]', detail);
    first.focus();
  }

  async function doCheckIn(btn) {
    const v = selected;
    const consent = $('#ci-consent', detail);
    const idBox = $('#ci-id', detail);
    const cat = masters.categories.find((c) => c.id === v.categoryId);
    let invalid = null;
    if (consent && req.declaration && !consent.checked) { $('#ci-consent-error', detail).textContent = 'The visitor declaration must be accepted before check-in'; invalid = invalid || consent; }
    if (idBox && cat?.requiresId && !idBox.checked) { $('#ci-id-error', detail).textContent = `Identity verification is required for ${cat.name} visitors`; invalid = invalid || idBox; }
    if (invalid) { invalid.focus(); return; }
    setBusy(btn, true, 'Checking in…');
    try {
      const res = await api(`/visits/${v.id}/check-in`, {
        method: 'POST',
        body: { consentGiven: consent ? consent.checked : undefined, idVerified: idBox ? idBox.checked : undefined, accessAreaId: $('#ci-area', detail).value || null },
      });
      toast(res.message);
      renderDetail(res.visit);
      selected = res.visit;
      load();
    } catch (err) {
      setBusy(btn, false);
      if (err.status === 403 && err.code === 'RESTRICTED_VISITOR') { toast(err.message, 'error'); load(); render(detail, emptyState('Entry denied', err.message, 'shieldAlert')); return; }
      toastError(err);
    }
  }

  const search = debounce(() => load(true), 250);
  input.addEventListener('input', search);
  $('[data-search]', root).addEventListener('submit', (e) => { e.preventDefault(); search.cancel(); load(true); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { const f = $('.lookup-item', list); if (f) { e.preventDefault(); f.focus(); } }
    if (e.key === 'Escape') { input.value = ''; load(); }
  });
  list.addEventListener('keydown', (e) => {
    const btns = $$('.lookup-item', list);
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)].focus(); }
    if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); if (i === 0) input.focus(); else btns[i - 1].focus(); }
  });
  on(list, 'click', '[data-visit]', (e, b) => select(b.dataset.visit));
  on(detail, 'submit', '[data-ci-form]', (e) => { e.preventDefault(); doCheckIn($('[data-do-checkin]', detail)); });
  on(detail, 'click', '[data-cancel-select]', () => { selected = null; render(detail, html`<div class="card-header"><h2>Visitor Details</h2></div>${emptyState('Select a visitor', 'Choose a visitor from the list, or scan a QR code.', 'logIn')}`); input.focus(); input.select(); });
  on(detail, 'click', '[data-next]', () => { selected = null; input.value = ''; load(); render(detail, html`<div class="card-header"><h2>Visitor Details</h2></div>${emptyState('Select a visitor', 'Choose a visitor from the list, or scan a QR code.', 'logIn')}`); input.focus(); });
  on(detail, 'click', '[data-print-pass]', () => openPrint(`/print/pass/${selected.id}`));
  on(detail, 'click', '[data-print-record]', () => openPrint(`/print/record/${selected.id}`));
  on(detail, 'click', '[data-approve]', async () => {
    try {
      await api(`/visits/${selected.id}/decision`, { method: 'POST', body: { decision: 'APPROVE', remarks: 'Approved at reception by administrator' } });
      toast('The visit has been approved.');
      const { visit } = await api(`/visits/${selected.id}`);
      selected = visit;
      renderDetail();
      load();
    } catch (err) { toastError(err); }
  });

  await load(true);
  input.focus();
}
