import { html, render, $, $$, on, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { fmtTime, fmtDate, fmtDuration, fmtDurationWords, fmtNumber } from '../lib/format.js';
import { emptyState, loadingBlock, toast, toastError, setBusy, alertBox } from '../lib/ui.js';
import { lookupItem, visitSummary, watchlistAlert } from '../components/visitCard.js';

export default async function checkout(root, { query }) {
  let items = [];
  let selected = null;
  let timer = null;

  render(root, html`
    <div class="page-header">
      <div><h1>Visitor Check-Out</h1><div class="subtitle">Search by visitor name, mobile, Visitor Pass Number, Visit Reference Number, or scan the pass QR code.</div></div>
    </div>
    <div class="desk">
      <section class="card" aria-labelledby="co-list-title">
        <div class="card-header" style="display:block">
          <h2 id="co-list-title" class="sr-only">Visitors on premises</h2>
          <form role="search" data-search novalidate class="search-field">
            ${icon('search', 'lead')}
            <label for="co-q" class="sr-only">Search visitor to check out</label>
            <input id="co-q" class="input lg" type="search" autocomplete="off" placeholder="Name / Mobile / Pass No. / Visit No. / scan QR code" value="${query.get('q') || ''}">
          </form>
          <div class="muted mt-1" style="font-size:.84rem" data-count role="status"></div>
        </div>
        <div class="lookup-list" data-list>${loadingBlock('Loading visitors on premises…')}</div>
      </section>
      <section class="card visit-card" aria-live="polite" data-detail>
        <div class="card-header"><h2>Visitor Details</h2></div>
        ${emptyState('Select a visitor', 'Choose a visitor from the list, or scan the visitor pass, to record the departure.', 'logOut')}
      </section>
    </div>`);

  const input = $('#co-q', root);
  const list = $('[data-list]', root);
  const detail = $('[data-detail]', root);

  async function load(auto = false) {
    const q = input.value.trim();
    try {
      items = (await api('/visits/lookup', { query: { mode: 'checkout', q } })).items;
      $('[data-count]', root).textContent = q ? `${fmtNumber(items.length)} matching visitor${items.length === 1 ? '' : 's'} on premises` : `${fmtNumber(items.length)} visitor${items.length === 1 ? '' : 's'} currently on premises`;
      render(list, items.length ? html`${items.map((v) => lookupItem(v, { mode: 'checkout', current: selected?.id === v.id }))}`
        : emptyState(q ? 'No visitor on premises matches the search' : 'No visitors are currently on premises', q ? 'Check the pass number, or search by mobile number.' : '', 'mapPin'));
      if (auto && q && items.length === 1) select(items[0].id);
    } catch (err) { toastError(err); }
  }

  function select(id) {
    selected = items.find((v) => v.id === Number(id));
    if (!selected) return;
    $$('.lookup-item', list).forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.visit) === selected.id)));
    renderDetail();
  }

  function renderDetail() {
    const v = selected;
    clearInterval(timer);
    const elapsed = () => Math.max(0, Math.floor((Date.now() - new Date(v.checkInAt).getTime()) / 60000));
    render(detail, html`
      <div class="card-header"><h2>Visitor Check-Out</h2>${v.status === 'OVERSTAY' ? html`<span class="status OVERSTAY">Overstay</span>` : ''}</div>
      ${visitSummary(v)}
      <form class="card-body" style="padding-top:0" data-co-form novalidate>
        ${watchlistAlert(v)}
        <dl class="kv">
          <dt>Visitor Pass Number</dt><dd class="mono">${v.pass?.passNumber || '—'}</dd>
          <dt>Date &amp; Time of Arrival</dt><dd>${fmtDate(v.checkInAt)} ${fmtTime(v.checkInAt)}</dd>
          <dt>Valid Until</dt><dd>${fmtTime(v.validUntil)}</dd>
          <dt>Duration so far</dt><dd><span class="big-duration" data-elapsed>${fmtDuration(elapsed())}</span> <span class="muted">hh:mm</span></dd>
        </dl>
        <div class="field mt-2"><label for="co-remarks">Remarks (optional)</label><input id="co-remarks" class="input" maxlength="300" placeholder="e.g. Pass returned, escorted out"></div>
        <div class="row mt-2">
          <button type="submit" class="btn danger lg" data-do-checkout>${icon('logOut')}CHECK OUT</button>
          <button type="button" class="btn lg ghost" data-cancel-select>Cancel</button>
        </div>
      </form>`);
    timer = setInterval(() => { const e = $('[data-elapsed]', detail); if (e) e.textContent = fmtDuration(elapsed()); }, 30_000);
    $('[data-do-checkout]', detail).focus();
  }

  function renderDone(v) {
    clearInterval(timer);
    render(detail, html`
      <div class="card-header"><h2>Check-Out Recorded</h2></div>
      ${visitSummary(v)}
      <div class="card-body" style="padding-top:0">
        ${alertBox('success', 'Visitor check-out has been recorded successfully.', '')}
        <dl class="kv mt-2">
          <dt>Check-In</dt><dd>${fmtTime(v.checkInAt)}</dd>
          <dt>Check-Out</dt><dd>${fmtTime(v.checkOutAt)}</dd>
          <dt>Duration</dt><dd><span class="big-duration">${fmtDuration(v.durationMinutes)}</span> <span class="muted">(${fmtDurationWords(v.durationMinutes)})</span></dd>
        </dl>
        <button type="button" class="btn primary lg mt-2" data-next>Next visitor</button>
      </div>`);
    $('[data-next]', detail).focus();
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
  on(detail, 'submit', '[data-co-form]', async (e) => {
    e.preventDefault();
    const btn = $('[data-do-checkout]', detail);
    setBusy(btn, true, 'Recording…');
    try {
      const res = await api(`/visits/${selected.id}/check-out`, { method: 'POST', body: { remarks: $('#co-remarks', detail).value.trim() || null } });
      toast(res.message);
      renderDone(res.visit);
      selected = null;
      load();
    } catch (err) { setBusy(btn, false); toastError(err); }
  });
  on(detail, 'click', '[data-cancel-select]', () => { clearInterval(timer); selected = null; render(detail, html`<div class="card-header"><h2>Visitor Details</h2></div>${emptyState('Select a visitor', 'Choose a visitor from the list, or scan the visitor pass.', 'logOut')}`); input.focus(); });
  on(detail, 'click', '[data-next]', () => { input.value = ''; load(); render(detail, html`<div class="card-header"><h2>Visitor Details</h2></div>${emptyState('Select a visitor', 'Choose a visitor from the list, or scan the visitor pass.', 'logOut')}`); input.focus(); });

  await load(true);
  input.focus();
  return () => clearInterval(timer);
}
