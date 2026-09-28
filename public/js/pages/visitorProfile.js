import { html, render, $, on, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can } from '../lib/state.js';
import { getMasters } from '../lib/masters.js';
import { navigate, openPrint } from '../lib/router.js';
import { createCombobox } from '../lib/combobox.js';
import { fmtDate, fmtTime, fmtDuration, fmtLongDate, fmtDurationWords, statusBadge, maskMobile } from '../lib/format.js';
import { dataTable, pager } from '../lib/table.js';
import {
  emptyState, loadingBlock, toast, toastError, modal, field, options, showFieldErrors, clearErrors, setBusy, confirmDialog, alertBox, highlight,
} from '../lib/ui.js';

export default async function visitorProfile(root, { params }) {
  const id = Number(params.id);
  let page = 1;
  let data;
  let revealed = false;

  async function loadProfile() {
    data = await api(`/visitors/${id}`);
    drawHeader();
  }

  function drawHeader() {
    const v = data.visitor;
    const s = data.stats;
    render($('[data-profile]', root), html`
      <div class="card-body" style="display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:20px;align-items:start">
        ${v.photoUrl ? html`<img src="${v.photoUrl}" alt="Photograph of ${v.fullName}" style="width:120px;height:160px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">`
          : html`<div class="thumb-initials" style="width:120px;height:160px;border-radius:10px;font-size:2rem">${initials(v.fullName)}</div>`}
        <div style="min-width:0">
          <div class="muted mono" style="font-size:.85rem">${v.visitorCode}${v.recordStatus !== 'ACTIVE' ? html` · <span class="tag warning">${v.recordStatus}</span>` : ''}</div>
          <h1 style="font-size:1.6rem;letter-spacing:.02em">${v.fullName.toUpperCase()}</h1>
          <div class="strong" style="color:var(--text-2);font-size:1.02rem">${v.companyName || 'Individual'}${v.designation ? html` · <span style="font-weight:500">${v.designation}</span>` : ''}</div>
          <dl class="kv mt-2" style="grid-template-columns:130px minmax(0,1fr)">
            <dt>Mobile</dt><dd class="mono">${v.mobileNumber ? `${v.mobileCountryCode} ${revealed ? v.mobileNumber : maskMobile(v.mobileNumber)}` : '—'}
              ${v.mobileNumber && can('visitor.update') ? html`<button type="button" class="btn ghost sm" data-reveal>${revealed ? 'Hide' : 'Show'}</button>` : ''}</dd>
            <dt>Email</dt><dd>${v.email || '—'}</dd>
            <dt>Identity</dt><dd>${v.idTypeName ? `${v.idTypeName} ${v.idReference || ''}` : '—'}</dd>
            ${v.address ? html`<dt>Address</dt><dd>${v.address}</dd>` : ''}
          </dl>
          ${v.watchlistStatus !== 'NONE' ? html`<div class="mt-2">${alertBox(v.watchlistStatus === 'BLOCKED' ? 'danger' : 'warning', v.watchlistStatus === 'BLOCKED' ? 'Restricted visitor – entry not permitted' : 'Flagged visitor', html`${v.watchlistReason || ''}`)}</div>` : ''}
        </div>
        <div class="stack" style="min-width:210px">
          ${can('visit.create') && v.recordStatus === 'ACTIVE' ? html`<a class="btn primary" href="/register?q=${v.mobileNumber || v.visitorCode}">${icon('userPlus')}Register New Visit</a>` : ''}
          ${can('visitor.update') && v.recordStatus !== 'ANONYMISED' ? html`<button type="button" class="btn" data-edit>${icon('edit')}Edit Visitor Information</button>` : ''}
          ${can('visitor.watchlist') ? html`<button type="button" class="btn" data-watchlist>${icon('shieldAlert')}Manage Restriction</button>` : ''}
          <button type="button" class="btn" data-print-history>${icon('printer')}Print Visitor History</button>
          ${can('visitor.archive') && v.recordStatus === 'ACTIVE' ? html`<button type="button" class="btn danger-outline" data-archive>${icon('trash')}Archive Record</button>` : ''}
          ${can('visitor.archive') && v.recordStatus === 'ARCHIVED' ? html`<button type="button" class="btn" data-restore>${icon('refresh')}Restore Record</button>` : ''}
        </div>
      </div>
      <div class="card-footer">
        <div class="stats" style="grid-template-columns:repeat(5,minmax(0,1fr));margin:0">
          ${[['Total Visits', s.totalVisits], ['First Visit', v.firstVisitAt ? fmtDate(v.firstVisitAt) : '—'], ['Last Visit', v.lastVisitAt ? fmtDate(v.lastVisitAt) : '—'],
            ['Average Duration', s.averageDurationMinutes != null ? fmtDurationWords(s.averageDurationMinutes) : '—'], ['Hosts Met', s.distinctHosts]].map(([l, val]) => html`
            <div class="stat" style="min-height:0;box-shadow:none"><span class="stat-label">${l}</span><span class="stat-value" style="font-size:1.35rem">${val}</span></div>`)}
        </div>
      </div>`);
  }

  async function loadHistory() {
    const box = $('[data-history]', root);
    try {
      const res = await api(`/visitors/${id}/visits`, { query: { page, pageSize: 10 } });
      render(box, html`${dataTable({
        caption: 'Visit history',
        columns: [
          { key: 'date', label: 'Date', render: (h) => html`<a href="/visits/${h.id}">${fmtDate(h.appointmentDate)}</a><div class="cell-sub mono">${h.visitCode}</div>` },
          { key: 'host', label: 'Host', render: (h) => html`<div>${h.host.name}</div><div class="cell-sub">${h.host.designation}</div>` },
          { key: 'purpose', label: 'Purpose', render: (h) => h.purpose },
          { key: 'in', label: 'Check-In', render: (h) => fmtTime(h.checkInAt) || '—' },
          { key: 'out', label: 'Check-Out', render: (h) => fmtTime(h.checkOutAt) || '—' },
          { key: 'dur', label: 'Duration', num: true, render: (h) => fmtDuration(h.durationMinutes ?? (h.checkInAt ? h.elapsedMinutes : null)) || '—' },
          { key: 'status', label: 'Status', render: (h) => statusBadge(h.status) },
        ],
        rows: res.items,
        rowAttrs: (h) => ({ cls: 'clickable', href: `/visits/${h.id}` }),
        empty: emptyState('No visits recorded', 'This visitor has no visit history yet.', 'history'),
      })}${res.total > 10 ? pager({ page, pageSize: 10, total: res.total, label: 'visits' }) : ''}`);
    } catch (err) { toastError(err); }
  }

  render(root, html`
    <nav class="muted mb-1" aria-label="Breadcrumb" style="font-size:.86rem"><a href="/visitors">Visitor Search &amp; History</a> › Visitor Profile</nav>
    <section class="card mb-2" data-profile>${loadingBlock('Loading visitor profile…')}</section>
    <section class="card" aria-labelledby="hist-title">
      <div class="card-header"><h2 id="hist-title">Visit History</h2></div>
      <div data-history>${loadingBlock('Loading visitor history…')}</div>
    </section>`);

  try { await loadProfile(); } catch (err) { render(root, emptyState('Visitor record not found', err.message, 'user')); return; }
  loadHistory();

  on(root, 'click', '[data-reveal]', () => { revealed = !revealed; drawHeader(); });
  on(root, 'click', '[data-print-history]', () => openPrint(`/print/visitor/${id}`));
  on(root, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); loadHistory(); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a,button')) navigate(tr.dataset.href); });
  on(root, 'click', '[data-archive]', async () => {
    if (!(await confirmDialog({ title: 'Archive visitor record', message: 'Archived visitors no longer appear in the returning-visitor search. Their visit history is retained. Continue?', confirmLabel: 'Archive', danger: true }))) return;
    try { const r = await api(`/visitors/${id}/archive`, { method: 'POST' }); toast(r.message); await loadProfile(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-restore]', async () => {
    try { const r = await api(`/visitors/${id}/restore`, { method: 'POST' }); toast(r.message); await loadProfile(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-watchlist]', () => watchlistDialog(data.visitor, async () => loadProfile()));
  on(root, 'click', '[data-edit]', () => editVisitorDialog(data.visitor, async () => loadProfile()));
}

export function watchlistDialog(v, onDone) {
  const m = modal({
    title: `Restriction – ${v.fullName}`,
    body: html`<form data-wl novalidate class="stack">
      <fieldset style="border:0;padding:0;margin:0" class="stack"><legend class="field-label mb-1">Restriction status</legend>
        ${[['NONE', 'No restriction', 'Normal visitor.'], ['FLAGGED', 'Flagged', 'Allowed entry; Security is alerted on every registration.'], ['BLOCKED', 'Blocked / Restricted', 'Entry not permitted. Registrations are recorded as denied and Security is alerted.']].map(([val, l, d]) => html`
          <label class="checkbox box"><input type="radio" name="status" value="${val}" ${v.watchlistStatus === val ? 'checked' : ''}><span><b>${l}</b><br><span class="muted" style="font-size:.85rem">${d}</span></span></label>`)}
      </fieldset>
      ${field({ id: 'wl-reason', label: 'Reason', help: 'Required when flagging or blocking. Visible to reception and security.', control: html`<textarea id="wl-reason" name="reason" class="textarea" maxlength="300" aria-describedby="wl-reason-error wl-reason-help">${v.watchlistReason || ''}</textarea>` })}
    </form>`,
    footer: html`<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-save>Save Restriction</button>`,
  });
  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    const f = m.el.querySelector('[data-wl]');
    const status = f.querySelector('input[name=status]:checked')?.value || 'NONE';
    setBusy(e.currentTarget, true, 'Saving…');
    try {
      const r = await api(`/visitors/${v.id}/watchlist`, { method: 'PUT', body: { status, reason: f.reason.value.trim() } });
      toast(r.message);
      m.close();
      onDone?.();
    } catch (err) {
      setBusy(e.currentTarget, false);
      if (err.fields) showFieldErrors(f, err.fields, { reason: 'wl-reason' }); else toastError(err);
    }
  });
}

async function editVisitorDialog(v, onDone) {
  const masters = await getMasters();
  let company = v.companyId ? { id: v.companyId, name: v.companyName } : null;
  const m = modal({
    title: 'Edit Visitor Information',
    size: 'wide',
    body: html`<form data-ev novalidate><div class="grid cols-2">
      ${field({ id: 'ev-name', label: 'Full Name', required: true, control: html`<input id="ev-name" name="fullName" class="input" value="${v.fullName}" maxlength="120">` })}
      <div class="field"><label for="ev-mobile">Mobile Number<span class="req">*</span></label>
        <div class="input-group"><label for="ev-cc" class="sr-only">Country code</label><input id="ev-cc" name="mobileCountryCode" class="input" style="width:80px;flex:none;border-radius:6px 0 0 6px" value="${v.mobileCountryCode}">
        <input id="ev-mobile" name="mobileNumber" class="input mono" value="${v.mobileNumber || ''}" maxlength="15"></div>
        <div class="error-text" id="ev-mobile-error" role="alert"></div></div>
      ${field({ id: 'ev-email', label: 'Email Address', control: html`<input id="ev-email" name="email" class="input" value="${v.email || ''}">` })}
      <div class="field"><label for="ev-company">Organisation / Company</label><div><input id="ev-company" class="input" value="${v.companyName || ''}"></div><div class="error-text" id="ev-company-error"></div></div>
      ${field({ id: 'ev-designation', label: 'Designation', control: html`<input id="ev-designation" name="designation" class="input" value="${v.designation || ''}">` })}
      ${field({ id: 'ev-alt', label: 'Alternate Contact Number', control: html`<input id="ev-alt" name="alternateContact" class="input" value="${v.alternateContact || ''}">` })}
      ${field({ id: 'ev-idtype', label: 'ID Type', control: html`<select id="ev-idtype" name="idTypeId" class="select">${options(masters.idTypes, v.idTypeId, { placeholder: 'Not recorded' })}</select>` })}
      ${field({ id: 'ev-idref', label: 'ID Number / Reference Number', control: html`<input id="ev-idref" name="idReference" class="input mono" value="${v.idReference || ''}">` })}
      ${field({ id: 'ev-address', label: 'Address', cls: 'span-2', control: html`<input id="ev-address" name="address" class="input" value="${v.address || ''}">` })}
    </div></form>`,
    footer: html`<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-save>Save Visitor Information</button>`,
  });
  const f = m.el.querySelector('[data-ev]');
  createCombobox(m.el.querySelector('#ev-company'), {
    fetch: async (q, signal) => (await api('/companies', { query: { q, compact: 'true', pageSize: 8 }, signal })).items,
    renderItem: (c, q) => html`<div class="opt-main">${highlight(c.name, q)}</div>`,
    itemLabel: (c) => c.name,
    createOption: (q, items) => (can('company.create') && q.length >= 2 && !items.some((c) => c.name.toLowerCase() === q.toLowerCase()) ? { label: html`${icon('plus')} Add New Company “${q}”`, item: { newName: q }, inputValue: q } : null),
    onSelect: (c) => { company = c; },
  });
  m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    clearErrors(f);
    const body = {
      fullName: f.fullName.value, mobileCountryCode: f.mobileCountryCode.value, mobileNumber: f.mobileNumber.value, email: f.email.value,
      designation: f.designation.value, alternateContact: f.alternateContact.value, address: f.address.value,
      idTypeId: f.idTypeId.value || null,
    };
    if (f.idReference.value.trim() !== (v.idReference || '')) body.idReference = f.idReference.value;
    if (company?.id) body.companyId = company.id; else if (company?.newName) body.newCompanyName = company.newName; else if (!m.el.querySelector('#ev-company').value.trim()) body.companyId = null;
    setBusy(e.currentTarget, true, 'Saving…');
    try {
      const r = await api(`/visitors/${v.id}`, { method: 'PUT', body });
      toast(r.message);
      m.close();
      onDone?.();
    } catch (err) {
      setBusy(e.currentTarget, false);
      if (err.fields) {
        const unmatched = showFieldErrors(f, err.fields, { fullName: 'ev-name', mobileNumber: 'ev-mobile', email: 'ev-email', designation: 'ev-designation', alternateContact: 'ev-alt', idTypeId: 'ev-idtype', idReference: 'ev-idref', address: 'ev-address', companyId: 'ev-company' });
        if (unmatched.length) toast(unmatched[0], 'error');
      } else toastError(err);
    }
  });
}
