import { html, render, $, $$, on, debounce, initials, focusables } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { session, can, org } from '../lib/state.js';
import { getMasters } from '../lib/masters.js';
import { createCombobox } from '../lib/combobox.js';
import { setLeaveGuard, openPrint } from '../lib/router.js';
import {
  fmtLongDate, fmtTime, fmtDate, todayIso, nowTimeHHMM, durationOptions, statusBadge, fmtNumber,
} from '../lib/format.js';
import {
  field, options, alertBox, clearErrors, showFieldErrors, setFieldError, toast, toastError, modal, promptDialog,
  confirmDialog, setBusy, highlight,
} from '../lib/ui.js';
import { captureFromCamera, uploadFromFile } from '../lib/camera.js';
import { dateField, timeField } from '../lib/datetimeField.js';

const DRAFT_KEY = 'vms.registrationDraft';
const DESIGNATIONS = ['Managing Director', 'Director', 'General Manager', 'Manager', 'Consultant', 'Engineer', 'Sales Executive', 'Government Official', 'Vendor', 'Contractor', 'Advocate', 'Auditor', 'Student', 'Candidate'];
const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+65', '+971', '+966', '+974', '+968', '+973', '+965', '+60', '+62', '+49', '+33', '+81', '+86', '+977', '+880', '+94'];
const VEHICLE_TYPES = [['TWO_WHEELER', 'Two Wheeler'], ['CAR', 'Car'], ['TAXI', 'Taxi'], ['BUS', 'Bus'], ['COMMERCIAL', 'Commercial Vehicle'], ['OTHER', 'Other']];

// API field name -> form control id
const FIELD_IDS = {
  fullName: 'v-name', mobileNumber: 'v-mobile', mobileCountryCode: 'v-cc', email: 'v-email', companyId: 'v-company', newCompanyName: 'v-company',
  designation: 'v-designation', alternateContact: 'v-alt', address: 'v-address', idTypeId: 'v-idtype', idReference: 'v-idnumber',
  photo: 'btn-capture', photoFileId: 'btn-capture', hostEmployeeId: 't-host', departmentId: 't-dept', purposeId: 't-purpose',
  purposeOther: 't-purpose-other', appointmentDate: 't-date', expectedArrival: 't-arrival', expectedDurationMin: 't-duration',
  categoryId: 't-category', accessAreaId: 't-area', consentGiven: 't-consent', idVerified: 'v-idverified',
  'vehicle.registrationNumber': 't-vehicle', verificationRemarks: 'v-idremarks',
};

function mobileProblem(cc, n) {
  if (!n) return 'Mobile Number is required';
  if (!/^\d+$/.test(n)) return 'Mobile number must contain digits only';
  if (cc === '+91' && !/^[6-9]\d{9}$/.test(n)) return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9';
  if (cc !== '+91' && (n.length < 6 || n.length > 14)) return 'Enter a valid mobile number (6 to 14 digits)';
  if (/^(\d)\1+$/.test(n)) return 'This mobile number does not appear to be valid';
  return null;
}
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-()]*$/u;

export default async function register(root, { query }) {
  const masters = await getMasters();
  const vs = session.settings.visitor || {};
  const req = vs.requiredFields || {};
  const maxDuration = vs.maxDurationMinutes || 480;
  const defaultDuration = vs.defaultDurationMinutes || 60;
  const defaultCategory = masters.categories.find((c) => c.code === 'GUEST')?.id;

  const state = {
    visitor: null,          // existing visitor (summary) when reusing details
    original: null,         // original values of the existing visitor, for change detection
    company: null,          // { id, name } | { newName }
    host: null,             // employee
    photo: null,            // { fileId, url }
    visit: null,            // saved visit
    dirty: false,
    duplicateReason: null,
    prefilledFromLast: false,
  };

  render(root, html`
    <div class="page-header">
      <div>
        <h1>Visitor Registration</h1>
        <div class="subtitle">${org().receptionPoint || 'Reception'} · ${fmtLongDate(todayIso())}</div>
      </div>
      <div class="page-actions muted" style="font-size:.82rem">
        ${icon('keyboard')}<span><span class="kbd">F2</span> Search · <span class="kbd">Enter</span> Next field · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> Register</span>
      </div>
    </div>

    <section class="card mb-2" aria-labelledby="vs-title">
      <div class="search-panel">
        <h2 class="section-title" id="vs-title"><span class="step">1</span>Search Existing Visitor</h2>
        <form class="search-row" role="search" data-search-form novalidate>
          <div class="search-field">
            ${icon('search', 'lead')}
            <label for="vs-query" class="sr-only">Search Existing Visitor</label>
            <input id="vs-query" class="input lg" type="search" autocomplete="off" spellcheck="false"
              placeholder="Search by Mobile Number / Name / Company" aria-describedby="vs-help" maxlength="100">
          </div>
          <button type="submit" id="vs-search" class="btn primary lg">${icon('search')}Search</button>
          <button type="button" id="vs-new" class="btn lg">${icon('userPlus')}New Visitor</button>
          <button type="button" id="vs-clear" class="btn lg ghost">Clear</button>
        </form>
        <div id="vs-help" class="sr-only">Type a mobile number, name, organisation, email, or scan a visitor QR code. Results appear below.</div>
        <div class="search-results" id="vs-results" aria-live="polite"></div>
      </div>
    </section>

    <div data-draft-banner></div>

    <form class="card" id="reg-form" novalidate autocomplete="off" aria-label="Visitor registration form">
      <fieldset data-lock style="border:0;margin:0;padding:0;min-width:0">
        <legend class="sr-only">Visitor registration details</legend>
        <section class="form-section" aria-labelledby="sec-visitor">
          <h2 class="section-title" id="sec-visitor"><span class="step">2</span>Visitor Information<span class="aside" data-visitor-mode>New visitor</span></h2>
          <div data-existing-banner></div>
          <div class="grid cols-2">
            ${field({ id: 'v-name', label: 'Full Name', required: true, control: html`<input id="v-name" name="fullName" class="input" maxlength="120" autocomplete="off" autocapitalize="words" aria-required="true" aria-describedby="v-name-error">` })}
            <div class="field">
              <label for="v-mobile">Mobile Number<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
              <div class="input-group">
                <label for="v-cc" class="sr-only">Country code</label>
                <select id="v-cc" name="mobileCountryCode" class="select">${COUNTRY_CODES.map((c) => html`<option ${c === (org().defaultCountryCode || '+91') ? 'selected' : ''}>${c}</option>`)}</select>
                <input id="v-mobile" name="mobileNumber" class="input mono" inputmode="numeric" maxlength="15" autocomplete="off" aria-required="true" aria-describedby="v-mobile-error" placeholder="10-digit mobile number">
              </div>
              <div class="error-text" id="v-mobile-error" role="alert"></div>
              <div data-duplicate></div>
            </div>
            ${field({ id: 'v-email', label: 'Email Address', required: req.email, control: html`<input id="v-email" name="email" type="email" class="input" maxlength="254" autocomplete="off" aria-describedby="v-email-error" placeholder="name@organisation.com">` })}
            <div class="field">
              <label for="v-company">Organisation / Company${req.company ? html`<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span>` : ''}</label>
              <div><input id="v-company" class="input" maxlength="150" placeholder="Type to search organisations" aria-describedby="v-company-error v-company-help"></div>
              <div class="help" id="v-company-help" data-company-help>Select an existing organisation, or choose “+ Add New Company”.</div>
              <div class="error-text" id="v-company-error" role="alert"></div>
            </div>
            ${field({ id: 'v-designation', label: 'Designation', required: req.designation, control: html`<input id="v-designation" name="designation" class="input" maxlength="100" list="designation-list" autocomplete="off" aria-describedby="v-designation-error" placeholder="e.g. General Manager"><datalist id="designation-list">${DESIGNATIONS.map((d) => html`<option value="${d}"></option>`)}</datalist>` })}
            <div class="field" style="justify-content:flex-end">
              <button type="button" class="disclosure-btn" id="more-toggle" aria-expanded="false" aria-controls="more-fields">${icon('chevronRight')}Alternate contact &amp; address (optional)</button>
            </div>
            <div class="grid cols-2 span-all" id="more-fields" hidden>
              ${field({ id: 'v-alt', label: 'Alternate Contact Number', control: html`<input id="v-alt" name="alternateContact" class="input mono" inputmode="tel" maxlength="20" aria-describedby="v-alt-error">` })}
              ${field({ id: 'v-address', label: 'Address', control: html`<input id="v-address" name="address" class="input" maxlength="300" aria-describedby="v-address-error">` })}
            </div>
          </div>
        </section>

        <section class="form-section" aria-labelledby="sec-id">
          <h2 class="section-title" id="sec-id"><span class="step">3</span>Identity Verification &amp; Photograph<span class="aside">Sensitive – ${vs.idNumberStorage === 'FULL' ? 'stored in full' : 'only the last 4 characters are stored'}</span></h2>
          <div class="grid cols-2">
            <div class="grid cols-2">
              ${field({ id: 'v-idtype', label: 'ID Type', required: req.idType, control: html`<select id="v-idtype" name="idTypeId" class="select" aria-describedby="v-idtype-error">${options(masters.idTypes, null, { placeholder: 'Select ID type' })}</select>` })}
              ${field({ id: 'v-idnumber', label: 'ID Number / Reference Number', required: req.idNumber, control: html`<input id="v-idnumber" name="idReference" class="input mono" maxlength="40" autocomplete="off" aria-describedby="v-idnumber-error">` })}
              <div class="field span-all">
                <label class="checkbox box" for="v-idverified"><input type="checkbox" id="v-idverified" name="idVerified" aria-describedby="v-idverified-error"><span><b>ID Verified</b> – the original identity document has been sighted and matches the visitor</span></label>
                <div class="error-text" id="v-idverified-error" role="alert"></div>
              </div>
              <div class="span-all" data-id-remarks hidden>
                ${field({ id: 'v-idremarks', label: 'Verification Remarks', control: html`<input id="v-idremarks" name="verificationRemarks" class="input" maxlength="200" placeholder="Optional" aria-describedby="v-idremarks-error">` })}
              </div>
            </div>
            <div class="field">
              <span class="field-label">Visitor Photograph${req.photo ? html`<span class="req" aria-hidden="true">*</span>` : ''}</span>
              <div class="photo-block">
                <div class="photo-frame" data-photo-frame></div>
                <div class="photo-actions">
                  <button type="button" class="btn" id="btn-capture" aria-describedby="btn-capture-error">${icon('camera')}<span data-capture-label>Capture Photo</span></button>
                  <button type="button" class="btn" id="btn-upload">${icon('upload')}Upload Photo</button>
                  <button type="button" class="btn danger-outline" id="btn-photo-remove" hidden>${icon('trash')}Remove</button>
                  <input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp" hidden tabindex="-1">
                  <div class="help">JPEG, PNG or WebP. Photos are automatically resized and compressed.</div>
                  <div class="error-text" id="btn-capture-error" role="alert"></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="form-section" aria-labelledby="sec-visit">
          <h2 class="section-title" id="sec-visit"><span class="step">4</span>Visit Details<span class="aside" data-prefill-note></span></h2>
          <div class="grid cols-2">
            <div class="field">
              <label for="t-host">Host / Officer to be Met<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
              <div><input id="t-host" class="input" maxlength="100" placeholder="Search employee / host by name, designation or department" aria-required="true" aria-describedby="t-host-error"></div>
              <div data-host-card></div>
              <div class="error-text" id="t-host-error" role="alert"></div>
            </div>
            ${field({ id: 't-dept', label: 'Department / Section', help: 'Filled automatically from the selected host.', control: html`<select id="t-dept" name="departmentId" class="select" aria-describedby="t-dept-error t-dept-help">${options(masters.departments, null, { placeholder: 'Select host first' })}</select>` })}
            ${field({ id: 't-purpose', label: 'Purpose of Visit', required: true, control: html`<select id="t-purpose" name="purposeId" class="select" aria-required="true" aria-describedby="t-purpose-error">${options(masters.purposes, null, { placeholder: 'Select purpose of visit' })}</select>` })}
            <div data-purpose-other hidden>
              ${field({ id: 't-purpose-other', label: 'Specify Purpose', required: true, control: html`<input id="t-purpose-other" name="purposeOther" class="input" maxlength="150" aria-describedby="t-purpose-other-error">` })}
            </div>
            <div class="grid cols-3 span-all">
              ${field({ id: 't-date', label: 'Appointment Date', help: 'DD-MM-YYYY · ↑/↓ to change', control: html`<input id="t-date" name="appointmentDate" class="input" aria-describedby="t-date-error t-date-help">` })}
              ${field({ id: 't-arrival', label: 'Expected Arrival', help: 'e.g. 10:30 AM · ↑/↓ 15 minutes', control: html`<input id="t-arrival" name="expectedArrival" class="input" aria-describedby="t-arrival-error t-arrival-help">` })}
              ${field({ id: 't-duration', label: 'Expected Duration', control: html`<select id="t-duration" name="expectedDurationMin" class="select" aria-describedby="t-duration-error">${options(durationOptions(maxDuration), defaultDuration, { valueKey: 'value', labelKey: 'label' })}</select>` })}
            </div>
            ${field({ id: 't-category', label: 'Visitor Category', required: req.category, control: html`<select id="t-category" name="categoryId" class="select" aria-describedby="t-category-error">${options(masters.categories, defaultCategory, { placeholder: 'Select category' })}</select>` })}
          </div>
        </section>

        <section class="form-section" aria-labelledby="sec-access">
          <h2 class="section-title" id="sec-access"><span class="step">5</span>Vehicle &amp; Access</h2>
          <div class="grid cols-2">
            ${field({ id: 't-vehicle', label: 'Vehicle Registration Number', help: 'Leave blank if the visitor has no vehicle.', control: html`<input id="t-vehicle" name="vehicleNumber" class="input mono" maxlength="15" placeholder="e.g. KA01AB1234" style="text-transform:uppercase" aria-describedby="t-vehicle-error t-vehicle-help">` })}
            <div class="grid cols-3" data-vehicle-extra hidden>
              ${field({ id: 't-vehicle-type', label: 'Vehicle Type', control: html`<select id="t-vehicle-type" name="vehicleType" class="select">${VEHICLE_TYPES.map(([v, l]) => html`<option value="${v}" ${v === 'CAR' ? 'selected' : ''}>${l}</option>`)}</select>` })}
              ${field({ id: 't-driver', label: 'Driver Name', control: html`<input id="t-driver" name="driverName" class="input" maxlength="100">` })}
              <div class="field" style="justify-content:flex-end"><label class="checkbox" for="t-parking" style="min-height:var(--control-h);align-items:center"><input type="checkbox" id="t-parking" name="parkingRequired">Parking Required</label></div>
            </div>
            ${field({ id: 't-area', label: 'Access Area', required: req.accessArea, help: 'Restricted areas require host approval before check-in.', control: html`<select id="t-area" name="accessAreaId" class="select" aria-describedby="t-area-error t-area-help">${options(masters.accessAreas.map((a) => ({ ...a, name: a.isRestricted ? `${a.name} (restricted)` : a.name })), null, { placeholder: 'Select access area' })}</select>` })}
          </div>
        </section>

        <section class="form-section" aria-labelledby="sec-decl">
          <h2 class="section-title" id="sec-decl"><span class="step">6</span>Visitor Declaration</h2>
          <div class="declaration" id="decl-text">“${vs.declarationText || ''}”</div>
          <div class="field mb-2">
            <label class="checkbox box" for="t-consent" id="t-consent-box"><input type="checkbox" id="t-consent" name="consentGiven" aria-describedby="decl-text t-consent-error">
              <span><b>I acknowledge and accept the visitor guidelines.</b>${req.declaration ? html` <span class="req" aria-hidden="true">*</span><span class="sr-only">(required before check-in)</span>` : ''}</span></label>
            <div class="error-text" id="t-consent-error" role="alert"></div>
          </div>
        </section>
      </fieldset>

      <div class="result-panel" data-result aria-live="polite"></div>
      <div class="action-bar">
        <button type="submit" class="btn primary lg" id="btn-save">${icon('check')}Save / Register</button>
        <button type="button" class="btn success lg" id="btn-checkin">${icon('logIn')}Check-In</button>
        <button type="button" class="btn lg" id="btn-print-pass" disabled>${icon('printer')}Print Pass</button>
        <button type="button" class="btn lg" id="btn-print-record" disabled>${icon('report')}Print Visitor Record</button>
        <button type="button" class="btn lg ghost" id="btn-clear">Clear / Cancel</button>
        <div class="hint"><span><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> Register</span><span><span class="kbd">Esc</span> Close lists</span></div>
      </div>
    </form>
  `);

  const form = $('#reg-form', root);
  const q = $('#vs-query', root);
  const dateCtl = dateField($('#t-date', root), { value: todayIso() });
  const timeCtl = timeField($('#t-arrival', root), { value: nowTimeHHMM() });
  const results = $('#vs-results', root);
  const el = (id) => $(`#${id}`, root);

  // --------------------------------------------------------------------------
  // Comboboxes: organisation and host
  // --------------------------------------------------------------------------
  const companyBox = createCombobox(el('v-company'), {
    minChars: 1,
    fetch: async (term, signal) => (await api('/companies', { query: { q: term, compact: 'true', pageSize: 8 }, signal })).items,
    renderItem: (c, term) => html`<div class="opt-main">${highlight(c.name, term)}</div>${c.category ? html`<div class="opt-sub">${c.category}</div>` : ''}`,
    itemLabel: (c) => c.name,
    createOption: (term, items) => (can('company.create') && term.length >= 2 && !items.some((c) => c.name.toLowerCase() === term.toLowerCase())
      ? { label: html`${icon('plus')} Add New Company “${term}”`, item: { newName: term.replace(/\s+/g, ' ').trim() }, inputValue: term.trim() } : null),
    onSelect: (c) => {
      state.company = c;
      markDirty();
      setFieldError(form, 'v-company', '');
      $('[data-company-help]', root).textContent = c?.newName ? `“${c.newName}” will be added to the organisation directory.` : 'Select an existing organisation, or choose “+ Add New Company”.';
    },
    emptyText: 'No matching organisation found',
  });

  const hostBox = createCombobox(el('t-host'), {
    minChars: 1,
    fetch: async (term, signal) => (await api('/employees', { query: { q: term, pageSize: 8 }, signal })).items,
    renderItem: (e, term) => html`<div class="opt-main">${highlight(e.displayName, term)}</div><div class="opt-sub">${e.designation} · ${e.departmentName}</div>`,
    itemLabel: (e) => e.displayName,
    onSelect: (e) => { setHost(e); markDirty(); },
    emptyText: 'No matching employee / host found',
  });

  function setHost(e) {
    state.host = e;
    const card = $('[data-host-card]', root);
    if (e) {
      el('t-dept').value = String(e.departmentId || '');
      render(card, html`<div class="host-card">${icon('userCheck')}<div><b>${e.displayName}</b><br>${e.designation} · ${e.departmentName} Department</div></div>`);
      setFieldError(form, 't-host', '');
    } else {
      render(card, '');
    }
  }

  // --------------------------------------------------------------------------
  // Photo
  // --------------------------------------------------------------------------
  function renderPhoto() {
    const frame = $('[data-photo-frame]', root);
    render(frame, state.photo?.url
      ? html`<img src="${state.photo.url}" alt="Visitor photograph">`
      : html`<div class="placeholder">${icon('user')}No photograph</div>`);
    el('btn-photo-remove').hidden = !state.photo?.url;
    $('[data-capture-label]', root).textContent = state.photo?.url ? 'Retake Photo' : 'Capture Photo';
  }
  on(root, 'click', '#btn-capture', async () => {
    const photo = await captureFromCamera();
    if (photo) { state.photo = { fileId: photo.fileId, url: photo.url }; state.photoChanged = true; renderPhoto(); markDirty(); setFieldError(form, 'btn-capture', ''); toast('Photograph captured.'); }
  });
  on(root, 'click', '#btn-upload', () => el('photo-file').click());
  el('photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await uploadFromFile(file);
      if (photo) { state.photo = { fileId: photo.fileId, url: photo.url }; state.photoChanged = true; renderPhoto(); markDirty(); setFieldError(form, 'btn-capture', ''); toast('Photograph uploaded.'); }
    } catch (err) { toastError(err); }
    el('btn-upload').focus();
  });
  on(root, 'click', '#btn-photo-remove', () => {
    state.photo = null;
    state.photoChanged = true;
    renderPhoto();
    markDirty();
    el('btn-capture').focus();
  });

  // --------------------------------------------------------------------------
  // Conditional fields
  // --------------------------------------------------------------------------
  function syncConditional() {
    const purpose = masters.purposes.find((p) => String(p.id) === el('t-purpose').value);
    $('[data-purpose-other]', root).hidden = !purpose?.requiresSpecify;
    $('[data-vehicle-extra]', root).hidden = !el('t-vehicle').value.trim();
    $('[data-id-remarks]', root).hidden = !el('v-idverified').checked;
  }
  on(root, 'change', '#t-purpose', syncConditional);
  on(root, 'input', '#t-vehicle', syncConditional);
  on(root, 'change', '#v-idverified', syncConditional);
  on(root, 'click', '#more-toggle', (e, btn) => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    el('more-fields').hidden = !open;
    if (open) el('v-alt').focus();
  });

  // --------------------------------------------------------------------------
  // Search existing visitor
  // --------------------------------------------------------------------------
  let searchSeq = 0;
  async function runSearch({ explicit = false } = {}) {
    const term = q.value.trim();
    if (term.length < 2) {
      render(results, explicit ? html`<div class="search-status">Enter at least 2 characters of a mobile number, name or organisation.</div>` : '');
      return;
    }
    const seq = ++searchSeq;
    render(results, html`<div class="search-status" role="status"><span class="spinner sm" aria-hidden="true"></span>Searching visitor records…</div>`);
    try {
      const { items, total } = await api('/visitors/search', { query: { q: term, limit: 6 } });
      if (seq !== searchSeq) return;
      if (!items.length) {
        render(results, html`<div class="alert"><div class="alert-body"><div class="alert-title">No existing visitor found</div>
          No visitor record matches “${term}”. Press <b>New Visitor</b> to register a first-time visitor.</div></div>`);
        return;
      }
      render(results, html`
        <div class="search-status">${total === 1 ? '1 matching visitor' : `${fmtNumber(total)} matching visitors`}${total > items.length ? ` – showing the ${items.length} best matches` : ''}</div>
        ${items.map((v, i) => matchCard(v, i === 0, term))}`);
    } catch (err) {
      if (seq === searchSeq) render(results, alertBox('danger', '', html`${err.message}`));
    }
  }

  function matchCard(v, best, term) {
    const lv = v.lastVisit;
    return html`
      <article class="visitor-match ${best ? 'best' : ''}" aria-label="${v.fullName}">
        ${v.photoUrl ? html`<img class="photo" src="${v.photoUrl}" alt="">` : html`<span class="photo thumb-initials" style="width:64px;height:80px;border-radius:6px;font-size:1.2rem">${initials(v.fullName)}</span>`}
        <div>
          ${best ? html`<div class="found-label">${icon('checkCircle')} Existing Visitor Found</div>` : ''}
          <div class="name">${highlight(v.fullName.toUpperCase(), term.toUpperCase())}
            ${v.watchlistStatus !== 'NONE' ? html`<span class="tag danger">${icon('shieldAlert')}${v.watchlistStatus === 'BLOCKED' ? 'RESTRICTED – entry not permitted' : 'FLAGGED'}</span>` : ''}</div>
          <div class="company">${v.companyName ? highlight(v.companyName, term) : 'Individual'}${v.designation ? html` · ${v.designation}` : ''}</div>
          <dl>
            <div><dt>Mobile:</dt><dd class="mono">${v.mobileCountryCode} ${v.mobileNumber}</dd></div>
            <div><dt>Visitor ID:</dt><dd>${v.visitorCode}</dd></div>
            <div><dt>Last Visit:</dt><dd>${v.lastVisitAt ? fmtLongDate(v.lastVisitAt) : '—'}</dd></div>
            <div><dt>Total Visits:</dt><dd>${v.totalVisits}</dd></div>
            ${lv ? html`<div><dt>Last Host:</dt><dd>${lv.hostName}, ${lv.hostDesignation}</dd></div>
                     <div><dt>Last Purpose:</dt><dd>${lv.purpose}</dd></div>` : ''}
          </dl>
          ${v.watchlistStatus !== 'NONE' && v.watchlistReason ? html`<div class="cell-sub mt-1" style="color:var(--danger)">Reason on record: ${v.watchlistReason}</div>` : ''}
        </div>
        <div class="actions">
          <button type="button" class="btn ${best ? 'primary' : ''}" data-use-visitor="${v.id}">${icon('userCheck')}Use Existing Details</button>
          <a class="btn sm ghost" href="/visitors/${v.id}" target="_blank" rel="noopener">View profile</a>
        </div>
      </article>`;
  }

  const autoSearch = debounce(() => runSearch(), 300);
  q.addEventListener('input', () => { if (q.value.trim().length >= 3) autoSearch(); else { autoSearch.cancel(); if (!q.value.trim()) render(results, ''); } });
  $('[data-search-form]', root).addEventListener('submit', (e) => { e.preventDefault(); autoSearch.cancel(); runSearch({ explicit: true }); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; render(results, ''); }
    if (e.key === 'ArrowDown') { const first = $('[data-use-visitor]', results); if (first) { e.preventDefault(); first.focus(); } }
  });
  on(results, 'click', '[data-use-visitor]', async (e, btn) => {
    try {
      const { visitor } = await api(`/visitors/${btn.dataset.useVisitor}`);
      useExisting(visitor);
    } catch (err) { toastError(err); }
  });
  on(root, 'click', '#vs-new', () => startNew());
  on(root, 'click', '#vs-clear', () => { q.value = ''; render(results, ''); q.focus(); });

  // --------------------------------------------------------------------------
  // Existing visitor → populate the form
  // --------------------------------------------------------------------------
  function useExisting(v) {
    if (state.visit) resetForm({ keepSearch: true });
    state.visitor = v;
    state.duplicateReason = null;
    el('v-name').value = v.fullName;
    el('v-cc').value = v.mobileCountryCode;
    el('v-mobile').value = v.mobileNumber || '';
    el('v-email').value = v.email || '';
    el('v-designation').value = v.designation || '';
    el('v-alt').value = v.alternateContact || '';
    el('v-address').value = v.address || '';
    el('v-idtype').value = v.idTypeId ? String(v.idTypeId) : '';
    el('v-idnumber').value = v.idReference || '';
    state.company = v.companyId ? { id: v.companyId, name: v.companyName } : null;
    companyBox.set(state.company, v.companyName || '');
    state.photo = v.photoUrl ? { fileId: v.photoFileId, url: v.photoUrl } : null;
    state.photoChanged = false;
    renderPhoto();
    if (v.alternateContact || v.address) { el('more-toggle').setAttribute('aria-expanded', 'true'); el('more-fields').hidden = false; }
    state.original = currentVisitorValues();
    render($('[data-duplicate]', root), '');
    render($('[data-existing-banner]', root), html`
      <div class="existing-banner">${icon('userCheck')}
        <div><b>Existing visitor ${v.visitorCode}</b> · ${v.totalVisits} previous visit${v.totalVisits === 1 ? '' : 's'}${v.lastVisitAt ? html` · last visit ${fmtLongDate(v.lastVisitAt)}` : ''}.
        Verify the details below and update only what has changed.</div>
      </div>
      ${v.watchlistStatus === 'BLOCKED' ? alertBox('danger', 'Restricted visitor – entry not permitted', html`${v.watchlistReason || ''} Registration will be recorded as denied and Security will be alerted.`) : ''}
      ${v.watchlistStatus === 'FLAGGED' ? alertBox('warning', 'Flagged visitor', html`${v.watchlistReason || ''} Security will be notified on registration.`) : ''}`);
    $('[data-visitor-mode]', root).textContent = 'Existing visitor – details reused';
    // Pre-fill the visit from the last visit to minimise typing; the operator confirms the host.
    const lv = v.lastVisit;
    if (lv && lv.hostId) {
      const dept = masters.departments.find((d) => d.name === lv.department);
      const hostItem = { id: lv.hostId, displayName: lv.hostName, designation: lv.hostDesignation, departmentName: lv.department, departmentId: dept?.id };
      hostBox.set(hostItem);
      setHost(hostItem);
      if (lv.purposeId && masters.purposes.some((p) => p.id === lv.purposeId && !p.requiresSpecify)) el('t-purpose').value = String(lv.purposeId);
      if (lv.categoryId) el('t-category').value = String(lv.categoryId);
      state.prefilledFromLast = true;
      $('[data-prefill-note]', root).textContent = 'Pre-filled from the last visit – confirm or change';
    }
    syncConditional();
    markDirty();
    el('t-host').focus();
    el('t-host').select();
    toast(`Existing visitor details loaded: ${v.fullName}`, 'info', { timeout: 3000 });
  }

  function startNew() {
    const term = q.value.trim();
    if (state.visitor || state.visit) resetForm({ keepSearch: true });
    const digits = term.replace(/[\s\-+()]/g, '');
    if (/^\d{6,15}$/.test(digits) && !el('v-mobile').value) el('v-mobile').value = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;
    else if (term && NAME_RE.test(term) && !el('v-name').value) el('v-name').value = term.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    render(results, '');
    el('v-name').focus();
    if (el('v-name').value) el('v-name').select();
  }

  // --------------------------------------------------------------------------
  // Duplicate detection on the mobile number (new visitors only)
  // --------------------------------------------------------------------------
  async function checkDuplicate() {
    const box = $('[data-duplicate]', root);
    if (state.visitor || state.visit) { render(box, ''); return; }
    const cc = el('v-cc').value;
    const n = el('v-mobile').value.replace(/[\s\-()]/g, '');
    if (mobileProblem(cc, n)) { render(box, ''); return; }
    try {
      const { matches } = await api('/visitors/check-duplicate', { query: { mobileCountryCode: cc, mobileNumber: n } });
      if (!matches.length || state.visitor) { render(box, ''); return; }
      const m = matches[0];
      render(box, html`<div class="alert warning mt-1" role="alert">${icon('alert')}<div class="alert-body">
        <div class="alert-title">Existing Visitor Found</div>
        <b>${m.fullName}</b>${m.companyName ? html` – ${m.companyName}` : ''} (${m.visitorCode}, ${m.totalVisits} visits) is already registered with this mobile number.
        <div class="alert-actions">
          <button type="button" class="btn sm primary" data-dup-use="${m.id}">Use Existing Visitor</button>
          <button type="button" class="btn sm" data-dup-different>Different person – create new record</button>
        </div></div></div>`);
    } catch { /* non-blocking */ }
  }
  el('v-mobile').addEventListener('blur', checkDuplicate);
  on(root, 'click', '[data-dup-use]', async (e, btn) => {
    try { useExisting((await api(`/visitors/${btn.dataset.dupUse}`)).visitor); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-dup-different]', async () => {
    const reason = await promptDialog({
      title: 'Create a separate visitor record',
      label: 'Reason for creating a new record with the same mobile number',
      help: 'For example: shared company phone, family member. This reason is recorded in the audit log.',
      confirmLabel: 'Confirm new record',
    });
    if (reason) {
      state.duplicateReason = reason;
      render($('[data-duplicate]', root), html`<div class="help mt-1">${icon('info')} A new visitor record will be created. Reason: ${reason}</div>`);
      el('v-email').focus();
    }
  });

  // --------------------------------------------------------------------------
  // Keyboard: Enter advances, Ctrl+Enter registers, F2 focuses search
  // --------------------------------------------------------------------------
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (state.visit) el('btn-checkin').click(); else form.requestSubmit(el('btn-save'));
      return;
    }
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const t = e.target;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
    if (t.getAttribute('role') === 'combobox' && t.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    if (t.type === 'checkbox') { t.checked = !t.checked; t.dispatchEvent(new Event('change', { bubbles: true })); return; }
    const items = focusables(form);
    const next = items[items.indexOf(t) + 1];
    next?.focus();
  });
  const onGlobalKey = (e) => {
    if (e.key === 'F2') { e.preventDefault(); q.focus(); q.select(); }
  };
  document.addEventListener('keydown', onGlobalKey);

  // --------------------------------------------------------------------------
  // Dirty tracking, draft protection
  // --------------------------------------------------------------------------
  function markDirty() {
    state.dirty = true;
    saveDraft();
  }
  form.addEventListener('input', () => { if (!state.visit) markDirty(); });
  form.addEventListener('change', () => { if (!state.visit) markDirty(); });

  const saveDraft = debounce(() => {
    if (state.visit || !state.dirty) return;
    try {
      const values = {};
      for (const c of form.elements) {
        if (!c.id || c.type === 'file' || c.tagName === 'BUTTON' || c.id === 'v-idnumber' || c.tagName === 'FIELDSET') continue;
        values[c.id] = c.type === 'checkbox' ? c.checked : c.value;
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(), values, visitorId: state.visitor?.id || null, company: state.company, host: state.host, photo: state.photo, duplicateReason: state.duplicateReason,
      }));
    } catch { /* storage unavailable: beforeunload warning still protects the operator */ }
  }, 400);

  function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

  async function offerDraft() {
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
    if (!draft || Date.now() - draft.savedAt > 8 * 3600_000 || !Object.values(draft.values || {}).some((v) => v && v !== true && String(v).length > 1)) return;
    const name = draft.values['v-name'] || 'unnamed visitor';
    render($('[data-draft-banner]', root), html`<div class="mb-2">${alertBox('warning', 'Unsaved registration recovered',
      html`An unsaved registration for <b>${name}</b> from ${fmtTime(new Date(draft.savedAt))} was found. The ID number is never stored in drafts.`,
      html`<button type="button" class="btn sm primary" data-draft-restore>Restore</button><button type="button" class="btn sm" data-draft-discard>Discard</button>`)}</div>`);
    on($('[data-draft-banner]', root), 'click', '[data-draft-restore]', async () => {
      if (draft.visitorId) {
        try { useExisting((await api(`/visitors/${draft.visitorId}`)).visitor); } catch { /* fall through */ }
      }
      for (const [id, v] of Object.entries(draft.values)) {
        const c = el(id);
        if (!c) continue;
        if (c.type === 'checkbox') c.checked = Boolean(v); else c.value = v;
      }
      if (draft.company) { state.company = draft.company; companyBox.set(draft.company, draft.company.name || draft.company.newName); }
      if (draft.host) { hostBox.set(draft.host); setHost(draft.host); }
      if (draft.photo) { state.photo = draft.photo; state.photoChanged = true; renderPhoto(); }
      state.duplicateReason = draft.duplicateReason;
      syncConditional();
      state.dirty = true;
      render($('[data-draft-banner]', root), '');
      el('v-name').focus();
    });
    on($('[data-draft-banner]', root), 'click', '[data-draft-discard]', () => { clearDraft(); render($('[data-draft-banner]', root), ''); q.focus(); });
  }

  const beforeUnload = (e) => {
    if (state.dirty && !state.visit) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);
  setLeaveGuard(() => state.dirty && !state.visit);

  // --------------------------------------------------------------------------
  // Validation & submission
  // --------------------------------------------------------------------------
  function currentVisitorValues() {
    return {
      fullName: el('v-name').value.trim().replace(/\s+/g, ' '),
      mobileCountryCode: el('v-cc').value,
      mobileNumber: el('v-mobile').value.replace(/[\s\-()]/g, '').replace(/^0+/, ''),
      email: el('v-email').value.trim() || null,
      designation: el('v-designation').value.trim() || null,
      alternateContact: el('v-alt').value.trim() || null,
      address: el('v-address').value.trim() || null,
      idTypeId: el('v-idtype').value ? Number(el('v-idtype').value) : null,
      idReference: el('v-idnumber').value.trim().toUpperCase() || null,
      companyKey: state.company?.id ? `id:${state.company.id}` : state.company?.newName ? `new:${state.company.newName}` : null,
    };
  }

  function validate(forCheckIn) {
    const f = {};
    const v = currentVisitorValues();
    if (!v.fullName) f.fullName = 'Full Name is required';
    else if (v.fullName.length < 2) f.fullName = 'Full Name must be at least 2 characters';
    else if (!NAME_RE.test(v.fullName)) f.fullName = 'Full Name must contain letters only (numbers are not allowed)';
    const mp = mobileProblem(v.mobileCountryCode, v.mobileNumber);
    if (mp) f.mobileNumber = mp;
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) f.email = 'Enter a valid email address';
    else if (req.email && !v.email) f.email = 'Email Address is required';
    if (!state.company && el('v-company').value.trim()) f.companyId = 'Select an organisation from the list, or choose “+ Add New Company”';
    else if (req.company && !state.company) f.companyId = 'Organisation / Company is required';
    if (req.designation && !v.designation) f.designation = 'Designation is required';
    if (req.idType && !v.idTypeId) f.idTypeId = 'ID Type is required';
    if (req.idNumber && !v.idReference) f.idReference = 'ID Number / Reference Number is required';
    if (v.idReference && !v.idTypeId) f.idTypeId = 'Select the ID Type for this reference number';
    if (v.idReference && !/^[A-Z0-9\-/ ]{3,40}$/.test(v.idReference)) f.idReference = 'Enter a valid ID / reference number';
    if (req.photo && !state.photo) f.photo = 'Visitor photograph is required';
    if (!state.host) f.hostEmployeeId = el('t-host').value.trim() ? 'Select the host from the list of employees' : 'Host / Officer to be Met is required';
    if (!el('t-purpose').value) f.purposeId = 'Purpose of Visit is required';
    else if (!$('[data-purpose-other]', root).hidden && !el('t-purpose-other').value.trim()) f.purposeOther = 'Please specify the purpose of visit';
    const date = dateCtl.get();
    if (!el('t-date').value.trim()) f.appointmentDate = 'Appointment Date is required';
    else if (!date) f.appointmentDate = 'Enter a valid date in the format DD-MM-YYYY';
    else if (date < todayIso()) f.appointmentDate = 'Appointment Date cannot be in the past';
    if (forCheckIn && date && date > todayIso()) f.appointmentDate = 'Check-in is only possible for visits scheduled today. Use Save / Register for a future appointment.';
    if (el('t-arrival').value.trim() && !timeCtl.get()) f.expectedArrival = 'Enter a valid time, e.g. 10:30 AM';
    if (req.category && !el('t-category').value) f.categoryId = 'Visitor Category is required';
    if (req.accessArea && !el('t-area').value) f.accessAreaId = 'Access Area is required';
    const veh = el('t-vehicle').value.trim().toUpperCase().replace(/\s+/g, '');
    if (veh && !/^[A-Z0-9-]{4,15}$/.test(veh)) f['vehicle.registrationNumber'] = 'Enter a valid vehicle registration number (letters and digits only)';
    if (forCheckIn && req.declaration && !el('t-consent').checked) f.consentGiven = 'The visitor declaration must be accepted before check-in';
    const cat = masters.categories.find((c) => String(c.id) === el('t-category').value);
    if (forCheckIn && cat?.requiresId && !el('v-idverified').checked) f.idVerified = `Identity verification is required for ${cat.name} visitors`;
    return f;
  }

  function buildPayload(checkIn) {
    const v = currentVisitorValues();
    let visitor;
    if (state.visitor) {
      // Send only what changed on the existing master record.
      visitor = {};
      for (const k of ['fullName', 'mobileCountryCode', 'mobileNumber', 'email', 'designation', 'alternateContact', 'address', 'idTypeId', 'idReference']) {
        if ((v[k] ?? null) !== (state.original[k] ?? null)) visitor[k] = v[k];
      }
      if (v.companyKey !== state.original.companyKey) {
        if (state.company?.id) visitor.companyId = state.company.id; else if (state.company?.newName) visitor.newCompanyName = state.company.newName; else visitor.companyId = null;
      }
      if (state.photoChanged) visitor.photoFileId = state.photo?.fileId || null;
      if (state.duplicateReason) visitor.duplicateOverrideReason = state.duplicateReason;
    } else {
      visitor = {
        fullName: v.fullName, mobileCountryCode: v.mobileCountryCode, mobileNumber: v.mobileNumber, email: v.email, designation: v.designation,
        alternateContact: v.alternateContact, address: v.address, idTypeId: v.idTypeId, idReference: v.idReference,
        companyId: state.company?.id || null, newCompanyName: state.company?.newName || null, photoFileId: state.photo?.fileId || null,
        duplicateOverrideReason: state.duplicateReason || null,
      };
    }
    const vehicleNumber = el('t-vehicle').value.trim();
    const visit = {
      hostEmployeeId: state.host?.id,
      departmentId: el('t-dept').value || null,
      purposeId: el('t-purpose').value,
      purposeOther: $('[data-purpose-other]', root).hidden ? null : el('t-purpose-other').value.trim(),
      appointmentDate: dateCtl.get(),
      expectedArrival: timeCtl.get(),
      expectedDurationMin: Number(el('t-duration').value),
      categoryId: el('t-category').value || null,
      accessAreaId: el('t-area').value || null,
      idVerified: el('v-idverified').checked,
      verificationRemarks: el('v-idverified').checked ? el('v-idremarks').value.trim() || null : null,
      consentGiven: el('t-consent').checked,
      vehicle: vehicleNumber ? {
        registrationNumber: vehicleNumber, vehicleType: el('t-vehicle-type').value, driverName: el('t-driver').value.trim() || null, parkingRequired: el('t-parking').checked,
      } : undefined,
    };
    return { visitorId: state.visitor?.id || undefined, visitor, visit, checkIn };
  }

  async function submit(checkIn) {
    clearErrors(form);
    const errors = validate(checkIn);
    if (Object.keys(errors).length) {
      showFieldErrors(form, errors, FIELD_IDS);
      toast('Please correct the highlighted fields.', 'warning', { timeout: 3500 });
      return;
    }
    const btn = el(checkIn ? 'btn-checkin' : 'btn-save');
    setBusy(btn, true, checkIn ? 'Checking in…' : 'Saving…');
    try {
      const res = await api('/visits', { method: 'POST', body: buildPayload(checkIn) });
      setBusy(btn, false);
      onSaved(res);
    } catch (err) {
      setBusy(btn, false);
      if (err.status === 409 && err.details?.type === 'DUPLICATE_VISITOR') return duplicateDialog(err.details);
      if (err.fields) {
        const unmatched = showFieldErrors(form, err.fields, FIELD_IDS);
        toast(unmatched[0] || err.message, 'error');
      } else toastError(err);
    }
  }

  function duplicateDialog(details) {
    const m0 = details.matches[0];
    const dlg = modal({
      title: 'Existing Visitor Found',
      body: html`<p>A visitor is already registered with this mobile number. Do not create a duplicate record unless this is a different person.</p>
        ${details.matches.map((m) => html`<div class="visitor-match mb-1" style="grid-template-columns:48px minmax(0,1fr)">
          ${m.photoUrl ? html`<img class="photo" style="width:48px;height:60px" src="${m.photoUrl}" alt="">` : html`<span class="thumb-initials">${initials(m.fullName)}</span>`}
          <div><div class="name">${m.fullName}</div><div class="company">${m.companyName || 'Individual'} · ${m.visitorCode}</div>
          <div class="cell-sub">${m.totalVisits} visits${m.lastVisitAt ? ` · last ${fmtLongDate(m.lastVisitAt)}` : ''}</div></div></div>`)}`,
      footer: html`<button type="button" class="btn" data-close>Cancel</button>
        ${details.canOverride ? html`<button type="button" class="btn" data-different>Different Person – Create New Record</button>` : ''}
        <button type="button" class="btn primary" data-use>Use Existing Visitor</button>`,
      initialFocus: '[data-use]',
    });
    dlg.el.querySelector('[data-use]').addEventListener('click', async () => {
      dlg.close();
      try { useExisting((await api(`/visitors/${m0.id}`)).visitor); } catch (err) { toastError(err); }
    });
    dlg.el.querySelector('[data-different]')?.addEventListener('click', async () => {
      dlg.close();
      const reason = await promptDialog({ title: 'Create a separate visitor record', label: 'Reason for creating a new record with the same mobile number', help: 'This reason is recorded in the audit log.', confirmLabel: 'Confirm and register' });
      if (reason) { state.duplicateReason = reason; submit(false); }
    });
  }

  function lockForm(locked) {
    $('[data-lock]', root).disabled = locked;
    el('btn-save').disabled = locked;
  }

  function onSaved(res) {
    const v = res.visit;
    state.visit = v;
    state.dirty = false;
    clearDraft();
    lockForm(true);
    const checkedIn = v.status === 'CHECKED_IN';
    const canCheckIn = ['APPROVED', 'EXPECTED'].includes(v.status) && v.appointmentDate === todayIso() && can('visit.checkin');
    el('btn-checkin').disabled = !canCheckIn;
    el('btn-print-pass').disabled = !checkedIn;
    el('btn-print-record').disabled = !checkedIn;
    render($('[data-result]', root), html`
      ${(res.alerts || []).map((a) => html`<div class="mb-1">${alertBox(a.level === 'danger' ? 'danger' : 'warning', a.level === 'danger' ? 'Entry denied' : 'Security alert', html`${a.message}`)}</div>`)}
      ${v.status !== 'DENIED' ? alertBox('success', checkedIn ? 'Visitor successfully checked in.' : 'Visitor registration completed successfully.', html`
        <div class="inline-list mt-1">
          <span>Visitor: <b>${v.visitor.fullName}</b></span>
          <span>Visit Reference Number: <b class="mono">${v.visitCode}</b></span>
          ${v.pass ? html`<span>Visitor Pass Number: <b class="mono">${v.pass.passNumber}</b></span>` : ''}
          <span>Status: ${statusBadge(v.status)}</span>
          ${checkedIn ? html`<span>Date &amp; Time of Arrival: <b>${fmtDate(v.checkInAt)} ${fmtTime(v.checkInAt)}</b></span><span>Host notified: <b>${v.host.name}</b></span>` : ''}
        </div>
        ${v.status === 'PENDING_APPROVAL' ? html`<div class="mt-1">The host has been asked to approve this visit. Check-in will be possible once it is approved.</div>` : ''}
        ${v.status === 'EXPECTED' && v.appointmentDate > todayIso() ? html`<div class="mt-1">Scheduled for ${fmtLongDate(v.appointmentDate)}. Check the visitor in on arrival from the Check-In screen.</div>` : ''}`) : ''}`);
    $('[data-visitor-mode]', root).textContent = checkedIn ? 'Checked in' : 'Registered';
    const next = checkedIn ? el('btn-print-pass') : canCheckIn ? el('btn-checkin') : el('btn-clear');
    $('[data-result]', root).scrollIntoView({ block: 'center', behavior: 'instant' });
    next.focus({ preventScroll: true });
    toast(res.message, v.status === 'DENIED' ? 'error' : 'success');
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); if (!state.visit) submit(false); });
  on(root, 'click', '#btn-checkin', async (e, btn) => {
    if (!state.visit) { submit(true); return; }
    if (!['APPROVED', 'EXPECTED'].includes(state.visit.status)) return;
    setBusy(btn, true, 'Checking in…');
    try {
      const res = await api(`/visits/${state.visit.id}/check-in`, { method: 'POST', body: { consentGiven: el('t-consent').checked, idVerified: el('v-idverified').checked } });
      setBusy(btn, false);
      onSaved({ ...res, alerts: [] });
    } catch (err) {
      setBusy(btn, false);
      if (err.fields) {
        // Allow the operator to complete the missing items (declaration / ID verification).
        lockForm(false);
        el('btn-save').disabled = true;
        showFieldErrors(form, err.fields, FIELD_IDS);
        toast(err.message, 'warning');
      } else toastError(err);
    }
  });
  on(root, 'click', '#btn-print-pass', () => state.visit && openPrint(`/print/pass/${state.visit.id}`));
  on(root, 'click', '#btn-print-record', () => state.visit && openPrint(`/print/record/${state.visit.id}`));
  on(root, 'click', '#btn-clear', async () => {
    if (state.dirty && !state.visit) {
      const ok = await confirmDialog({ title: 'Clear registration', message: 'Discard the information entered for this visitor?', confirmLabel: 'Clear form', danger: true });
      if (!ok) return;
    }
    resetForm();
    q.focus();
  });

  function resetForm({ keepSearch = false } = {}) {
    lockForm(false);
    form.reset();
    clearErrors(form);
    dateCtl.set(todayIso(), false);
    timeCtl.set(nowTimeHHMM(), false);
    el('t-duration').value = String(defaultDuration);
    if (defaultCategory) el('t-category').value = String(defaultCategory);
    el('v-cc').value = org().defaultCountryCode || '+91';
    Object.assign(state, { visitor: null, original: null, company: null, host: null, photo: null, photoChanged: false, visit: null, dirty: false, duplicateReason: null, prefilledFromLast: false });
    companyBox.clear();
    hostBox.clear();
    setHost(null);
    renderPhoto();
    el('more-toggle').setAttribute('aria-expanded', 'false');
    el('more-fields').hidden = true;
    ['[data-result]', '[data-existing-banner]', '[data-duplicate]', '[data-draft-banner]'].forEach((s) => render($(s, root), ''));
    $('[data-visitor-mode]', root).textContent = 'New visitor';
    $('[data-prefill-note]', root).textContent = '';
    $('[data-company-help]', root).textContent = 'Select an existing organisation, or choose “+ Add New Company”.';
    el('btn-checkin').disabled = false;
    el('btn-print-pass').disabled = true;
    el('btn-print-record').disabled = true;
    syncConditional();
    clearDraft();
    if (!keepSearch) { q.value = ''; render(results, ''); }
  }

  // Initial state
  renderPhoto();
  syncConditional();
  await offerDraft();
  const preset = query.get('q');
  if (preset) { q.value = preset; runSearch({ explicit: true }); }
  q.focus();

  return () => {
    document.removeEventListener('keydown', onGlobalKey);
    window.removeEventListener('beforeunload', beforeUnload);
    companyBox.destroy();
    hostBox.destroy();
    setLeaveGuard(null);
  };
}
