import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, session } from '../lib/state.js';
import { getMasters } from '../lib/masters.js';
import { navigate, openPrint } from '../lib/router.js';
import { createCombobox } from '../lib/combobox.js';
import { fmtDate, fmtTime, fmtLongDate, todayIso, durationOptions, statusBadge } from '../lib/format.js';
import { dataTable } from '../lib/table.js';
import {
  field, options, emptyState, loadingBlock, toast, toastError, showFieldErrors, clearErrors, setBusy, alertBox, highlight, promptDialog,
} from '../lib/ui.js';

const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+65', '+971', '+966', '+974', '+60', '+49', '+33', '+81', '+86', '+977', '+880', '+94'];
const IDS = { fullName: 'p-name', mobileNumber: 'p-mobile', email: 'p-email', companyId: 'p-company', newCompanyName: 'p-company', purposeId: 'p-purpose', purposeOther: 'p-purpose-other', appointmentDate: 'p-date', expectedArrival: 'p-arrival', expectedDurationMin: 'p-duration', hostEmployeeId: 'p-host', categoryId: 'p-category', accessAreaId: 'p-area', specialInstructions: 'p-notes', designation: 'p-designation' };

export default async function prereg(root) {
  const masters = await getMasters();
  const vs = session.settings.visitor || {};
  const hostOnly = !can('prereg.any');
  let company = null;
  let host = null;

  render(root, html`
    <div class="page-header">
      <div><h1>Pre-Registration</h1><div class="subtitle">Register an expected visitor before arrival. A Visit Reference Number and QR code are generated for quick check-in.</div></div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1.25fr) minmax(320px,1fr);align-items:start">
      <form class="card" data-form novalidate aria-labelledby="pr-title">
        <div class="card-header"><h2 id="pr-title">Expected Visitor</h2></div>
        <div class="card-body">
          <div data-result aria-live="polite"></div>
          <div class="grid cols-2">
            ${field({ id: 'p-name', label: 'Visitor Name', required: true, control: html`<input id="p-name" name="fullName" class="input" maxlength="120" aria-describedby="p-name-error">` })}
            <div class="field"><label for="p-mobile">Mobile Number<span class="req" aria-hidden="true">*</span></label>
              <div class="input-group"><label for="p-cc" class="sr-only">Country code</label><select id="p-cc" class="select">${COUNTRY_CODES.map((c) => html`<option ${c === (session.settings.organisation.defaultCountryCode || '+91') ? 'selected' : ''}>${c}</option>`)}</select>
              <input id="p-mobile" name="mobileNumber" class="input mono" inputmode="numeric" maxlength="15" aria-describedby="p-mobile-error"></div>
              <div class="error-text" id="p-mobile-error" role="alert"></div></div>
            <div class="field"><label for="p-company">Organisation / Company</label><div><input id="p-company" class="input" placeholder="Type to search organisations" aria-describedby="p-company-error"></div><div class="error-text" id="p-company-error" role="alert"></div></div>
            ${field({ id: 'p-email', label: 'Email Address', control: html`<input id="p-email" name="email" type="email" class="input" maxlength="254" aria-describedby="p-email-error">` })}
            ${hostOnly
              ? html`<div class="field"><span class="field-label">Host / Officer to be Met</span><div class="host-card" style="margin-top:0">${icon('userCheck')}<div><b>${session.user.fullName}</b> (you)</div></div></div>`
              : html`<div class="field"><label for="p-host">Host / Officer to be Met<span class="req" aria-hidden="true">*</span></label><div><input id="p-host" class="input" placeholder="Search employee / host" aria-describedby="p-host-error"></div><div data-host-card></div><div class="error-text" id="p-host-error" role="alert"></div></div>`}
            ${field({ id: 'p-purpose', label: 'Purpose of Visit', required: true, control: html`<select id="p-purpose" name="purposeId" class="select" aria-describedby="p-purpose-error">${options(masters.purposes, null, { placeholder: 'Select purpose' })}</select>` })}
            <div data-other hidden class="span-all">${field({ id: 'p-purpose-other', label: 'Specify Purpose', required: true, control: html`<input id="p-purpose-other" name="purposeOther" class="input" maxlength="150" aria-describedby="p-purpose-other-error">` })}</div>
            <div class="grid cols-3 span-all">
              ${field({ id: 'p-date', label: 'Date', required: true, control: html`<input id="p-date" name="appointmentDate" type="date" class="input" min="${todayIso()}" value="${todayIso(1)}" aria-describedby="p-date-error">` })}
              ${field({ id: 'p-arrival', label: 'Expected Arrival', control: html`<input id="p-arrival" name="expectedArrival" type="time" class="input" value="10:00" aria-describedby="p-arrival-error">` })}
              ${field({ id: 'p-duration', label: 'Expected Duration', control: html`<select id="p-duration" name="expectedDurationMin" class="select">${options(durationOptions(vs.maxDurationMinutes || 480), vs.defaultDurationMinutes || 60, { valueKey: 'value', labelKey: 'label' })}</select>` })}
            </div>
            ${field({ id: 'p-category', label: 'Visitor Category', control: html`<select id="p-category" name="categoryId" class="select">${options(masters.categories, masters.categories.find((c) => c.code === 'GUEST')?.id)}</select>` })}
            ${field({ id: 'p-area', label: 'Access Area', control: html`<select id="p-area" name="accessAreaId" class="select">${options(masters.accessAreas, null, { placeholder: 'Not specified' })}</select>` })}
            ${field({ id: 'p-notes', label: 'Special Instructions', cls: 'span-all', control: html`<textarea id="p-notes" name="specialInstructions" class="textarea" maxlength="500" placeholder="e.g. Escort to Conference Room 2; bring original documents"></textarea>` })}
          </div>
        </div>
        <div class="card-footer row"><button type="submit" class="btn primary lg" data-submit>${icon('calendarCheck')}Pre-Register Visitor</button><button type="reset" class="btn lg ghost">Clear</button></div>
      </form>
      <section class="card" aria-labelledby="up-title">
        <div class="card-header"><h2 id="up-title">Upcoming Expected Visitors</h2></div>
        <div data-upcoming>${loadingBlock('Loading expected visitors…')}</div>
      </section>
    </div>`);

  const form = $('[data-form]', root);
  createCombobox($('#p-company', root), {
    fetch: async (q, signal) => (await api('/companies', { query: { q, compact: 'true', pageSize: 8 }, signal })).items,
    renderItem: (c, q) => html`<div class="opt-main">${highlight(c.name, q)}</div>`,
    itemLabel: (c) => c.name,
    createOption: (q, items) => (can('company.create') && q.length >= 2 && !items.some((c) => c.name.toLowerCase() === q.toLowerCase()) ? { label: html`${icon('plus')} Add New Company “${q}”`, item: { newName: q }, inputValue: q } : null),
    onSelect: (c) => { company = c; },
  });
  if (!hostOnly) {
    createCombobox($('#p-host', root), {
      fetch: async (q, signal) => (await api('/employees', { query: { q, pageSize: 8 }, signal })).items,
      renderItem: (e, q) => html`<div class="opt-main">${highlight(e.displayName, q)}</div><div class="opt-sub">${e.designation} · ${e.departmentName}</div>`,
      itemLabel: (e) => e.displayName,
      onSelect: (e) => {
        host = e;
        render($('[data-host-card]', root), e ? html`<div class="host-card">${icon('userCheck')}<div><b>${e.displayName}</b><br>${e.designation} · ${e.departmentName} Department</div></div>` : '');
      },
    });
  }
  on(root, 'change', '#p-purpose', (e) => { $('[data-other]', root).hidden = !masters.purposes.find((p) => String(p.id) === e.target.value)?.requiresSpecify; });

  async function loadUpcoming() {
    try {
      const res = await api('/visits', { query: { from: todayIso(), status: 'EXPECTED,PENDING_APPROVAL,APPROVED', sort: 'date', dir: 'asc', pageSize: 50 } });
      render($('[data-upcoming]', root), dataTable({
        caption: 'Upcoming expected visitors',
        columns: [
          { key: 'd', label: 'Date', render: (v) => html`<div class="nowrap">${fmtDate(v.appointmentDate)}</div><div class="cell-sub">${v.expectedArrival ? fmtTime(v.expectedArrival) : ''}</div>` },
          { key: 'v', label: 'Visitor', render: (v) => html`<a class="cell-main" href="/visits/${v.id}">${v.visitor.fullName}</a><div class="cell-sub">${v.companyName || 'Individual'}${hostOnly ? '' : ` · ${v.host.name}`}</div>` },
          { key: 's', label: 'Status', render: (v) => statusBadge(v.status) },
          { key: 'a', label: html`<span class="sr-only">Actions</span>`, render: (v) => html`<button type="button" class="btn sm" data-invite="${v.id}" aria-label="Print invitation for ${v.visitor.fullName}">${icon('qr')}</button>` },
        ],
        rows: res.items,
        empty: emptyState('No upcoming visitors', 'Pre-registered visitors will appear here.', 'calendar'),
      }));
    } catch (err) { toastError(err); }
  }

  form.addEventListener('reset', () => { company = null; host = null; clearErrors(form); render($('[data-result]', root), ''); if (!hostOnly) render($('[data-host-card]', root), ''); setTimeout(() => { $('#p-date', root).value = todayIso(1); $('#p-name', root).focus(); }); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const errors = {};
    const name = $('#p-name', root).value.trim();
    const mobile = $('#p-mobile', root).value.replace(/[\s-]/g, '');
    if (name.length < 2) errors.fullName = 'Visitor Name is required';
    if (!/^\d{6,14}$/.test(mobile)) errors.mobileNumber = 'Enter a valid mobile number';
    if (!hostOnly && !host) errors.hostEmployeeId = 'Host / Officer to be Met is required';
    if (!$('#p-purpose', root).value) errors.purposeId = 'Purpose of Visit is required';
    if (!$('[data-other]', root).hidden && !$('#p-purpose-other', root).value.trim()) errors.purposeOther = 'Please specify the purpose';
    if (!$('#p-date', root).value) errors.appointmentDate = 'Date is required';
    if (!company && $('#p-company', root).value.trim()) errors.companyId = 'Select an organisation from the list, or choose “+ Add New Company”';
    if (Object.keys(errors).length) { showFieldErrors(form, errors, IDS); return; }
    const btn = $('[data-submit]', root);
    setBusy(btn, true, 'Saving…');
    try {
      const res = await api('/pre-registration', {
        method: 'POST',
        body: {
          visitor: { fullName: name, mobileCountryCode: $('#p-cc', root).value, mobileNumber: mobile, email: $('#p-email', root).value.trim() || null, companyId: company?.id || null, newCompanyName: company?.newName || null },
          visit: {
            hostEmployeeId: host?.id || session.user.employeeId, purposeId: $('#p-purpose', root).value, purposeOther: $('#p-purpose-other', root).value.trim() || null,
            appointmentDate: $('#p-date', root).value, expectedArrival: $('#p-arrival', root).value || null, expectedDurationMin: Number($('#p-duration', root).value),
            categoryId: $('#p-category', root).value || null, accessAreaId: $('#p-area', root).value || null, specialInstructions: $('#p-notes', root).value.trim() || null,
          },
        },
      });
      setBusy(btn, false);
      const v = res.visit;
      render($('[data-result]', root), html`<div class="mb-2">${alertBox('success', 'Pre-registration completed successfully.', html`
        <div class="row mt-1" style="align-items:flex-start;gap:18px">
          <div class="qr-box"><img src="/api/visits/${v.id}/qr.svg" alt="QR code for visit ${v.visitCode}"><span class="code-ref">${v.visitCode}</span></div>
          <div><div>Visit Reference Number: <b class="mono">${v.visitCode}</b></div><div>${v.visitor.fullName} · ${fmtLongDate(v.appointmentDate)}${v.expectedArrival ? ` at ${fmtTime(v.expectedArrival)}` : ''}</div>
          <div>Status: ${statusBadge(v.status)}</div>
          <div class="row mt-1"><button type="button" class="btn sm primary" data-invite="${v.id}">${icon('printer')}Print Invitation</button><button type="button" class="btn sm" data-another>Register another</button></div></div>
        </div>`)}</div>`);
      (res.alerts || []).forEach((a) => toast(a.message, a.level === 'danger' ? 'error' : 'warning'));
      toast(res.message);
      $('[data-invite]', root).focus();
      loadUpcoming();
    } catch (err) {
      setBusy(btn, false);
      if (err.fields) { const u = showFieldErrors(form, err.fields, IDS); if (u.length) toast(u[0], 'error'); } else toastError(err);
    }
  });
  on(root, 'click', '[data-invite]', (e, b) => openPrint(`/print/invitation/${b.dataset.invite}`));
  on(root, 'click', '[data-another]', () => form.reset());
  loadUpcoming();
  $('#p-name', root).focus();
}
