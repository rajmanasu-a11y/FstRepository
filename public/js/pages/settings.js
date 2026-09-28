import { html, render, $, $$, on, formData } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, session } from '../lib/state.js';
import { invalidateMasters } from '../lib/masters.js';
import { replaceQuery } from '../lib/router.js';
import { createCombobox } from '../lib/combobox.js';
import { fmtDateTime, fmtDate } from '../lib/format.js';
import { dataTable } from '../lib/table.js';
import {
  field, options, emptyState, loadingBlock, toast, toastError, modal, showFieldErrors, clearErrors, setBusy, confirmDialog, alertBox, highlight,
} from '../lib/ui.js';
import { watchlistDialog } from './visitorProfile.js';

const TABS = [
  ['organisation', 'Organisation', 'settings.manage'],
  ['visitor', 'Visitor Rules', 'settings.manage'],
  ['masters', 'Masters', 'master.manage'],
  ['notification', 'Notifications', 'settings.manage'],
  ['print', 'Print Settings', 'settings.manage'],
  ['security', 'Security', 'settings.manage'],
  ['users', 'Users & Roles', 'user.manage'],
  ['watchlist', 'Restricted Visitors', 'visitor.watchlist'],
  ['retention', 'Data Retention', 'retention.manage'],
];

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Riyadh', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

const check = (id, name, label, checked, help = '') => html`<label class="checkbox box" for="${id}"><input type="checkbox" id="${id}" name="${name}" ${checked ? 'checked' : ''}><span><b>${label}</b>${help ? html`<br><span class="muted" style="font-size:.84rem">${help}</span>` : ''}</span></label>`;

export default async function settings(root, { query }) {
  const tabs = TABS.filter(([, , p]) => can(p));
  let active = tabs.find(([k]) => k === query.get('tab'))?.[0] || tabs[0][0];
  let data = null;

  render(root, html`
    <div class="page-header"><div><h1>Settings</h1><div class="subtitle">System configuration. Every change is recorded in the audit log.</div></div></div>
    <div class="tabs" role="tablist" aria-label="Settings sections">
      ${tabs.map(([k, l]) => html`<button type="button" role="tab" id="tab-${k}" aria-controls="panel" aria-selected="${k === active}" data-tab="${k}">${l}</button>`)}
    </div>
    <div id="panel" role="tabpanel" data-panel>${loadingBlock('Loading settings…')}</div>`);
  const panel = $('[data-panel]', root);

  async function loadData() {
    if (can('settings.manage') || can('retention.manage')) data = await api('/settings');
  }

  async function saveSetting(key, body, btn) {
    setBusy(btn, true, 'Saving…');
    try {
      const r = await api(`/settings/${key}`, { method: 'PUT', body });
      toast(r.message);
      const me = await api('/auth/me');
      session.settings = me.settings;
      await loadData();
    } catch (err) {
      if (err.fields) { const u = showFieldErrors(panel, err.fields); if (u.length) toast(u[0], 'error'); else toast(err.message, 'error'); } else toastError(err);
    } finally { setBusy(btn, false); }
  }

  // ---------------------------------------------------------------- panels
  const PANELS = {
    organisation() {
      const o = data.settings.organisation;
      render(panel, html`<form class="card" data-form novalidate>
        <div class="card-header"><h2>Organisation Details</h2></div>
        <div class="card-body"><div class="grid cols-2">
          ${field({ id: 'name', label: 'Organisation Name', required: true, control: html`<input id="name" name="name" class="input" value="${o.name || ''}" maxlength="150">` })}
          ${field({ id: 'shortName', label: 'Short Name', control: html`<input id="shortName" name="shortName" class="input" value="${o.shortName || ''}" maxlength="30">` })}
          ${field({ id: 'address', label: 'Address', cls: 'span-all', control: html`<input id="address" name="address" class="input" value="${o.address || ''}" maxlength="300">` })}
          ${field({ id: 'phone', label: 'Phone', control: html`<input id="phone" name="phone" class="input" value="${o.phone || ''}" maxlength="40">` })}
          ${field({ id: 'email', label: 'Email', control: html`<input id="email" name="email" class="input" value="${o.email || ''}" maxlength="254">` })}
          ${field({ id: 'website', label: 'Website', control: html`<input id="website" name="website" class="input" value="${o.website || ''}" maxlength="200">` })}
          ${field({ id: 'receptionPoint', label: 'Reception Point', required: true, help: 'Shown in host notifications (e.g. Main Entrance).', control: html`<input id="receptionPoint" name="receptionPoint" class="input" value="${o.receptionPoint || ''}" maxlength="80">` })}
          ${field({ id: 'timezone', label: 'Time Zone', required: true, control: html`<select id="timezone" name="timezone" class="select">${options([...new Set([o.timezone, ...TIMEZONES])], o.timezone)}</select>` })}
          ${field({ id: 'defaultCountryCode', label: 'Default Mobile Country Code', control: html`<input id="defaultCountryCode" name="defaultCountryCode" class="input" value="${o.defaultCountryCode || '+91'}" maxlength="5">` })}
          ${field({ id: 'footerText', label: 'Document Footer Text', cls: 'span-all', control: html`<input id="footerText" name="footerText" class="input" value="${o.footerText || ''}" maxlength="300">` })}
        </div></div>
        <div class="card-footer"><button type="submit" class="btn primary">Save Organisation Details</button></div>
      </form>
      <section class="card mt-2"><div class="card-header"><h2>Organisation Logo</h2></div><div class="card-body row" style="align-items:center;gap:20px">
        <div style="width:220px;height:90px;border:1px dashed var(--border-strong);border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fff">
          ${session.settings.organisation.logoUrl ? html`<img src="${session.settings.organisation.logoUrl}" alt="Current logo" style="max-width:200px;max-height:80px">` : html`<span class="muted">No logo uploaded</span>`}</div>
        <div class="stack"><div class="row"><button type="button" class="btn" data-logo-pick>${icon('upload')}Upload Logo</button>
          ${session.settings.organisation.logoUrl ? html`<button type="button" class="btn danger-outline" data-logo-remove>${icon('trash')}Remove</button>` : ''}</div>
          <div class="help">PNG, JPEG or WebP up to 2 MB. Used on the header, visitor passes and printed records.</div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" hidden tabindex="-1"></div>
      </div></section>`);
      $('[data-form]', panel).addEventListener('submit', (e) => { e.preventDefault(); clearErrors(e.target); saveSetting('organisation', formData(e.target), e.submitter); });
      on(panel, 'click', '[data-logo-pick]', () => $('#logo-file', panel).click());
      $('#logo-file', panel).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const form = new FormData();
        form.append('logo', file);
        try { const r = await api('/settings/logo', { method: 'POST', form }); toast(r.message); session.settings = (await api('/auth/me')).settings; PANELS.organisation(); } catch (err) { toastError(err); }
      });
      on(panel, 'click', '[data-logo-remove]', async () => {
        try { const r = await api('/settings/logo', { method: 'DELETE' }); toast(r.message); session.settings = (await api('/auth/me')).settings; PANELS.organisation(); } catch (err) { toastError(err); }
      });
    },

    visitor() {
      const v = data.settings.visitor;
      const rf = v.requiredFields || {};
      const reqLabels = [['email', 'Email Address'], ['company', 'Organisation / Company'], ['designation', 'Designation'], ['idType', 'ID Type'], ['idNumber', 'ID Number'], ['photo', 'Visitor Photograph'], ['category', 'Visitor Category'], ['accessArea', 'Access Area'], ['declaration', 'Visitor Declaration (before check-in)']];
      render(panel, html`<form class="card" data-form novalidate>
        <div class="card-header"><h2>Visitor Rules</h2></div>
        <div class="card-body stack">
          <div class="grid cols-3">
            ${field({ id: 'defaultDurationMinutes', label: 'Default Expected Duration (minutes)', control: html`<input id="defaultDurationMinutes" name="defaultDurationMinutes" type="number" min="5" max="1440" class="input" value="${v.defaultDurationMinutes}">` })}
            ${field({ id: 'maxDurationMinutes', label: 'Maximum Visit Duration (minutes)', control: html`<input id="maxDurationMinutes" name="maxDurationMinutes" type="number" min="15" max="1440" class="input" value="${v.maxDurationMinutes}">` })}
            ${field({ id: 'overstayGraceMinutes', label: 'Overstay Grace Period (minutes)', help: 'A visitor becomes OVERSTAY after the expected duration plus this grace period.', control: html`<input id="overstayGraceMinutes" name="overstayGraceMinutes" type="number" min="0" max="240" class="input" value="${v.overstayGraceMinutes}">` })}
          </div>
          ${check('requireApprovalForWalkIns', 'requireApprovalForWalkIns', 'Require host approval for all walk-in visitors', v.requireApprovalForWalkIns, 'Otherwise approval is required only for categories or access areas configured to need it.')}
          ${field({ id: 'idNumberStorage', label: 'ID Number Storage (privacy)', control: html`<select id="idNumberStorage" name="idNumberStorage" class="select" style="max-width:460px">
            <option value="MASKED" ${v.idNumberStorage === 'MASKED' ? 'selected' : ''}>Masked – store only the last 4 characters (recommended)</option>
            <option value="FULL" ${v.idNumberStorage === 'FULL' ? 'selected' : ''}>Full – store the complete reference number</option></select>` })}
          <fieldset style="border:0;padding:0;margin:0"><legend class="field-label mb-1">Mandatory fields during registration</legend>
            <div class="grid cols-3">${reqLabels.map(([k, l]) => check(`rf-${k}`, `rf.${k}`, l, rf[k]))}</div></fieldset>
          <div class="grid" style="grid-template-columns:minmax(0,1fr) 160px">
            ${field({ id: 'declarationText', label: 'Visitor Declaration Text', control: html`<textarea id="declarationText" name="declarationText" class="textarea" maxlength="1000">${v.declarationText}</textarea>` })}
            ${field({ id: 'declarationVersion', label: 'Declaration Version', help: 'Change when the text changes; the version accepted is recorded per visit.', control: html`<input id="declarationVersion" name="declarationVersion" class="input" value="${v.declarationVersion}" maxlength="10">` })}
          </div>
        </div>
        <div class="card-footer"><button type="submit" class="btn primary">Save Visitor Rules</button></div></form>`);
      $('[data-form]', panel).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const body = { defaultDurationMinutes: Number(f.defaultDurationMinutes), maxDurationMinutes: Number(f.maxDurationMinutes), overstayGraceMinutes: Number(f.overstayGraceMinutes), requireApprovalForWalkIns: f.requireApprovalForWalkIns, idNumberStorage: f.idNumberStorage, declarationText: f.declarationText, declarationVersion: f.declarationVersion, requiredFields: {} };
        for (const [k] of reqLabels) body.requiredFields[k] = f[`rf.${k}`];
        saveSetting('visitor', body, e.submitter);
      });
    },

    async masters() {
      let sub = 'departments';
      const SUBS = [['departments', 'Departments'], ['categories', 'Visitor Categories'], ['purposes', 'Purposes of Visit'], ['access-areas', 'Access Areas'], ['id-types', 'ID Types']];
      const EXTRA = {
        categories: [['requiresApproval', 'Requires host approval'], ['requiresId', 'Requires ID verification']],
        purposes: [['requiresSpecify', 'Requires “Specify Purpose” text']],
        'access-areas': [['isRestricted', 'Restricted area'], ['requiresApproval', 'Requires host approval']],
      };
      render(panel, html`<div class="card"><div class="card-header"><div class="segmented" role="group" aria-label="Master lists">${SUBS.map(([k, l]) => html`<button type="button" data-sub="${k}" aria-pressed="${k === sub}">${l}</button>`)}</div>
        <button type="button" class="btn primary" data-madd>${icon('plus')}Add</button></div><div data-mlist>${loadingBlock()}</div></div>`);
      let items = [];
      const loadSub = async () => {
        items = (await api(`/masters/${sub}`, { query: { all: 'true' } })).items;
        render($('[data-mlist]', panel), dataTable({
          caption: 'Master list',
          columns: [
            { key: 'code', label: 'Code', render: (m) => html`<span class="code-ref">${m.code}</span>` },
            { key: 'name', label: 'Name', render: (m) => html`<b>${m.name}</b>` },
            ...(EXTRA[sub] || []).map(([k, l]) => ({ key: k, label: l, render: (m) => (m[k] ? html`<span class="tag info">Yes</span>` : html`<span class="faint">No</span>`) })),
            ...(sub === 'categories' ? [{ key: 'rollCallGroup', label: 'Roll-call Group', render: (m) => m.rollCallGroup }] : []),
            { key: 'isActive', label: 'Status', render: (m) => (m.isActive ? html`<span class="tag success">Active</span>` : html`<span class="tag">Inactive</span>`) },
            { key: 'a', label: html`<span class="sr-only">Actions</span>`, render: (m) => html`<button type="button" class="btn sm" data-medit="${m.id}" aria-label="Edit ${m.name}">${icon('edit')}Edit</button>` },
          ],
          rows: items,
          empty: emptyState('No entries', 'Add the first entry.'),
        }));
      };
      const editDlg = (m) => {
        const dlg = modal({
          title: `${m ? 'Edit' : 'Add'} ${SUBS.find((s) => s[0] === sub)[1].replace(/s$/, '')}`,
          body: html`<form data-mf novalidate class="stack">
            ${field({ id: 'm-code', label: 'Code', required: true, control: html`<input id="m-code" name="code" class="input mono" maxlength="30" value="${m?.code || ''}">` })}
            ${field({ id: 'm-name', label: 'Name', required: true, control: html`<input id="m-name" name="name" class="input" maxlength="100" value="${m?.name || ''}">` })}
            ${(EXTRA[sub] || []).map(([k, l]) => check(`m-${k}`, k, l, m?.[k]))}
            ${sub === 'categories' ? field({ id: 'm-roll', label: 'Emergency Roll-call Group', control: html`<select id="m-roll" name="rollCallGroup" class="select">${options([['VISITOR', 'Visitors'], ['CONTRACTOR', 'Contractors'], ['SERVICE', 'Service Personnel'], ['EMPLOYEE', 'Employees (visiting staff)']].map(([id, name]) => ({ id, name })), m?.rollCallGroup || 'VISITOR')}</select>` }) : ''}
            ${sub !== 'departments' ? field({ id: 'm-sort', label: 'Display Order', control: html`<input id="m-sort" name="sortOrder" type="number" class="input" value="${m?.sortOrder ?? 100}">` }) : ''}
            ${check('m-active', 'isActive', 'Active', m ? m.isActive : true)}
          </form>`,
          footer: html`<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-msave>Save</button>`,
        });
        dlg.el.querySelector('[data-msave]').addEventListener('click', async (e) => {
          const f = dlg.el.querySelector('[data-mf]');
          const body = formData(f);
          if (body.sortOrder !== undefined) body.sortOrder = Number(body.sortOrder);
          setBusy(e.currentTarget, true, 'Saving…');
          try {
            const r = await api(m ? `/masters/${sub}/${m.id}` : `/masters/${sub}`, { method: m ? 'PUT' : 'POST', body });
            toast(r.message); dlg.close(); invalidateMasters(); loadSub();
          } catch (err) { setBusy(e.currentTarget, false); if (err.fields) showFieldErrors(f, err.fields, { code: 'm-code', name: 'm-name' }); else toastError(err); }
        });
      };
      on(panel, 'click', '[data-sub]', (e, b) => { sub = b.dataset.sub; $$('[data-sub]', panel).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadSub(); });
      on(panel, 'click', '[data-madd]', () => editDlg(null));
      on(panel, 'click', '[data-medit]', (e, b) => editDlg(items.find((x) => x.id === Number(b.dataset.medit))));
      await loadSub();
    },

    notification() {
      const n = data.settings.notification;
      render(panel, html`<form class="card" data-form novalidate>
        <div class="card-header"><h2>Host Notification Settings</h2></div>
        <div class="card-body stack">
          ${alertBox('info', 'How notifications are delivered', html`In-app notifications are delivered immediately. E-mail is sent through the SMTP server configured on the application server (${data.smtpConfigured ? html`<b>configured</b>` : html`<b>not configured</b> – e-mail notifications will be recorded as skipped`}). SMS and WhatsApp are integration points: until a provider adapter is installed, those notifications are recorded as skipped rather than silently dropped.`)}
          ${check('inApp', 'inApp', 'In-app notifications', n.inApp, 'Host users see arrivals and approval requests in the notification bell.')}
          <div class="grid cols-2">
            ${check('email', 'email', 'E-mail notifications', n.email?.enabled)}
            ${field({ id: 'fromAddress', label: 'E-mail “From” address', control: html`<input id="fromAddress" name="fromAddress" class="input" value="${n.email?.fromAddress || ''}" placeholder="vms@organisation.gov">` })}
            ${check('sms', 'sms', 'SMS notifications (provider integration)', n.sms?.enabled)}
            ${field({ id: 'smsProvider', label: 'SMS provider', control: html`<input id="smsProvider" name="smsProvider" class="input" value="${n.sms?.provider || ''}" placeholder="Not configured">` })}
            ${check('whatsapp', 'whatsapp', 'WhatsApp notifications (future integration)', n.whatsapp?.enabled)}
            ${field({ id: 'waProvider', label: 'WhatsApp provider', control: html`<input id="waProvider" name="waProvider" class="input" value="${n.whatsapp?.provider || ''}" placeholder="Not configured">` })}
          </div>
          <fieldset style="border:0;padding:0;margin:0"><legend class="field-label mb-1">Overstay alerts go to</legend>
            <div class="grid cols-4">${[['reception', 'Reception'], ['security', 'Security'], ['host', 'Host'], ['admin', 'Administrators']].map(([k, l]) => check(`ov-${k}`, `ov.${k}`, l, n.overstay?.[k]))}</div></fieldset>
          <fieldset style="border:0;padding:0;margin:0"><legend class="field-label mb-1">Restricted / flagged visitor alerts go to</legend>
            <div class="grid cols-4">${[['security', 'Security'], ['admin', 'Administrators']].map(([k, l]) => check(`ra-${k}`, `ra.${k}`, l, n.restrictedAlert?.[k]))}</div></fieldset>
        </div>
        <div class="card-footer"><button type="submit" class="btn primary">Save Notification Settings</button></div></form>`);
      $('[data-form]', panel).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = formData(e.target);
        saveSetting('notification', {
          inApp: f.inApp, email: { enabled: f.email, fromAddress: f.fromAddress }, sms: { enabled: f.sms, provider: f.smsProvider }, whatsapp: { enabled: f.whatsapp, provider: f.waProvider },
          overstay: { reception: f['ov.reception'], security: f['ov.security'], host: f['ov.host'], admin: f['ov.admin'] },
          restrictedAlert: { security: f['ra.security'], admin: f['ra.admin'] },
        }, e.submitter);
      });
    },

    print() {
      const t = Object.fromEntries(data.printTemplates.map((p) => [p.code, p.config]));
      const p = t.VISITOR_PASS || {};
      const r = t.HALF_A4_RECORD || {};
      render(panel, html`<div class="grid cols-2" style="align-items:start">
        <form class="card" data-pass novalidate><div class="card-header"><h2>Visitor Pass Template</h2></div><div class="card-body stack">
          <div class="grid cols-2">
            ${field({ id: 'widthMm', label: 'Badge Width (mm)', control: html`<input id="widthMm" name="widthMm" type="number" min="50" max="150" class="input" value="${p.widthMm}">` })}
            ${field({ id: 'heightMm', label: 'Badge Height (mm)', control: html`<input id="heightMm" name="heightMm" type="number" min="40" max="150" class="input" value="${p.heightMm}">` })}
          </div>
          ${field({ id: 'paper', label: 'Printer / Paper', control: html`<select id="paper" name="paper" class="select"><option value="BADGE" ${p.paper === 'BADGE' ? 'selected' : ''}>Badge / card printer (page = badge size)</option><option value="A4" ${p.paper === 'A4' ? 'selected' : ''}>Office printer (badge on A4 with cut line)</option></select>` })}
          ${field({ id: 'headerColor', label: 'Header Colour', control: html`<input id="headerColor" name="headerColor" type="color" class="input" style="width:90px;padding:2px" value="${p.headerColor || '#12305a'}">` })}
          ${check('showPhoto', 'showPhoto', 'Show visitor photograph', p.showPhoto !== false)}
          ${check('showQr', 'showQr', 'Show QR code (contains only a random verification token)', p.showQr !== false)}
          ${field({ id: 'instruction', label: 'Security Instruction', control: html`<textarea id="instruction" name="instruction" class="textarea" maxlength="300">${p.instruction || ''}</textarea>` })}
        </div><div class="card-footer"><button type="submit" class="btn primary">Save Pass Template</button></div></form>
        <form class="card" data-record novalidate><div class="card-header"><h2>Half-A4 Visitor Record</h2></div><div class="card-body stack">
          ${field({ id: 'title', label: 'Document Title', control: html`<input id="title" name="title" class="input" maxlength="60" value="${r.title || 'VISITOR RECORD'}">` })}
          <div class="grid cols-2">
            ${field({ id: 'copy1', label: 'Upper Copy Label', control: html`<input id="copy1" name="copy1" class="input" maxlength="40" value="${r.copies?.[0] || 'Office Copy'}">` })}
            ${field({ id: 'copy2', label: 'Lower Copy Label', control: html`<input id="copy2" name="copy2" class="input" maxlength="40" value="${r.copies?.[1] || 'Visitor Copy'}">` })}
          </div>
          ${check('rShowPhoto', 'showPhoto', 'Show visitor photograph', r.showPhoto !== false)}
          ${check('rShowQr', 'showQr', 'Show QR code / reference', r.showQr !== false)}
          ${check('rShowSig', 'showSignatures', 'Show signature fields', r.showSignatures !== false)}
          <div class="help">Logo and footer text are taken from the Organisation settings. Printers should use A4 portrait, “Actual size / 100%”, with browser headers and footers switched off.</div>
        </div><div class="card-footer"><button type="submit" class="btn primary">Save Record Template</button></div></form>
      </div>`);
      const saveTpl = async (code, body, btn) => {
        setBusy(btn, true, 'Saving…');
        try { const res = await api(`/settings/print-templates/${code}`, { method: 'PUT', body }); toast(res.message); session.settings = (await api('/auth/me')).settings; await loadData(); } catch (err) { if (err.fields) showFieldErrors(panel, err.fields); else toastError(err); } finally { setBusy(btn, false); }
      };
      $('[data-pass]', panel).addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); saveTpl('VISITOR_PASS', { ...f, widthMm: Number(f.widthMm), heightMm: Number(f.heightMm) }, e.submitter); });
      $('[data-record]', panel).addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); saveTpl('HALF_A4_RECORD', { title: f.title, copies: [f.copy1, f.copy2], showPhoto: f.showPhoto, showQr: f.showQr, showSignatures: f.showSignatures }, e.submitter); });
    },

    security() {
      const s = data.settings.security;
      render(panel, html`<form class="card" data-form novalidate>
        <div class="card-header"><h2>Security Settings</h2></div>
        <div class="card-body stack"><div class="grid cols-3">
          ${field({ id: 'sessionTimeoutMinutes', label: 'Session Inactivity Timeout (minutes)', control: html`<input id="sessionTimeoutMinutes" name="sessionTimeoutMinutes" type="number" min="5" max="480" class="input" value="${s.sessionTimeoutMinutes}">` })}
          ${field({ id: 'absoluteSessionHours', label: 'Maximum Session Length (hours)', control: html`<input id="absoluteSessionHours" name="absoluteSessionHours" type="number" min="1" max="24" class="input" value="${s.absoluteSessionHours}">` })}
          ${field({ id: 'passwordMinLength', label: 'Minimum Password Length', control: html`<input id="passwordMinLength" name="passwordMinLength" type="number" min="8" max="64" class="input" value="${s.passwordMinLength}">` })}
          ${field({ id: 'maxLoginAttempts', label: 'Failed Sign-in Attempts Before Lockout', control: html`<input id="maxLoginAttempts" name="maxLoginAttempts" type="number" min="3" max="20" class="input" value="${s.maxLoginAttempts}">` })}
          ${field({ id: 'lockoutMinutes', label: 'Lockout Duration (minutes)', control: html`<input id="lockoutMinutes" name="lockoutMinutes" type="number" min="1" max="1440" class="input" value="${s.lockoutMinutes}">` })}
        </div>
        ${check('passwordRequireComplexity', 'passwordRequireComplexity', 'Require complex passwords', s.passwordRequireComplexity, 'Upper- and lowercase letters, a number and a special character.')}
        ${check('maskMobileInPrint', 'maskMobileInPrint', 'Mask visitor mobile numbers on printed documents', s.maskMobileInPrint)}
        ${check('showContactOnEmergencyList', 'showContactOnEmergencyList', 'Show contact numbers on the emergency roll call', s.showContactOnEmergencyList, 'Only where organisational policy permits.')}
        </div><div class="card-footer"><button type="submit" class="btn primary">Save Security Settings</button></div></form>`);
      $('[data-form]', panel).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = formData(e.target);
        for (const k of ['sessionTimeoutMinutes', 'absoluteSessionHours', 'passwordMinLength', 'maxLoginAttempts', 'lockoutMinutes']) f[k] = Number(f[k]);
        saveSetting('security', f, e.submitter);
      });
    },

    async users() {
      const [{ items: roles }] = await Promise.all([api('/users/roles')]);
      let users = [];
      render(panel, html`<div class="card"><div class="card-header"><h2>User Accounts</h2><button type="button" class="btn primary" data-uadd>${icon('plus')}Add User</button></div><div data-ulist>${loadingBlock()}</div></div>
        <div class="card mt-2"><div class="card-header"><h2>Roles &amp; Permissions</h2><span class="hint">Role permissions are enforced by the server on every request.</span></div>
        <div class="card-body stack">${roles.map((r) => html`<div><b>${r.name}</b> <span class="muted">– ${r.description}</span><div class="row mt-1" style="gap:4px">${r.permissions.filter(Boolean).map((p) => html`<span class="tag">${p}</span>`)}</div></div>`)}</div></div>`);
      const loadUsers = async () => {
        users = (await api('/users')).items;
        render($('[data-ulist]', panel), dataTable({
          caption: 'User accounts',
          columns: [
            { key: 'u', label: 'Username', render: (u) => html`<span class="code-ref">${u.username}</span>` },
            { key: 'n', label: 'Full Name', render: (u) => html`<b>${u.fullName}</b>${u.employeeName ? html`<div class="cell-sub">Host: ${u.employeeName}</div>` : ''}` },
            { key: 'r', label: 'Role', render: (u) => u.roleName },
            { key: 's', label: 'Status', render: (u) => html`${u.isActive ? html`<span class="tag success">Active</span>` : html`<span class="tag">Inactive</span>`} ${u.locked ? html`<span class="tag danger">Locked</span>` : ''} ${u.mustChangePassword ? html`<span class="tag warning">Must change password</span>` : ''}` },
            { key: 'l', label: 'Last Sign-in', render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—') },
            { key: 'a', label: html`<span class="sr-only">Actions</span>`, render: (u) => html`<div class="row" style="gap:6px"><button type="button" class="btn sm" data-uedit="${u.id}">${icon('edit')}Edit</button><button type="button" class="btn sm" data-ureset="${u.id}">${icon('key')}Reset Password</button>${u.locked ? html`<button type="button" class="btn sm" data-uunlock="${u.id}">Unlock</button>` : ''}</div>` },
          ],
          rows: users,
        }));
      };
      const userDlg = (u) => {
        let employeeId = u?.employeeId || null;
        const dlg = modal({
          title: u ? `Edit User – ${u.username}` : 'Add User',
          size: 'wide',
          body: html`<form data-uf novalidate><div class="grid cols-2">
            ${field({ id: 'u-username', label: 'Username', required: true, control: html`<input id="u-username" name="username" class="input mono" maxlength="40" value="${u?.username || ''}" ${u ? 'readonly' : ''}>` })}
            ${field({ id: 'u-name', label: 'Full Name', required: true, control: html`<input id="u-name" name="fullName" class="input" maxlength="120" value="${u?.fullName || ''}">` })}
            ${field({ id: 'u-email', label: 'Email', control: html`<input id="u-email" name="email" class="input" value="${u?.email || ''}">` })}
            ${field({ id: 'u-role', label: 'Role', required: true, control: html`<select id="u-role" name="roleCode" class="select">${options(roles.map((r) => ({ id: r.code, name: r.name })), u?.roleCode || 'RECEPTION')}</select>` })}
            <div class="field"><label for="u-emp">Linked Employee / Host</label><div><input id="u-emp" class="input" value="${u?.employeeName || ''}" placeholder="Required for Host users"></div><div class="error-text" id="u-emp-error" role="alert"></div></div>
            ${u ? '' : field({ id: 'u-pass', label: 'Initial Password', required: true, help: 'The user must change it at first sign-in.', control: html`<input id="u-pass" name="password" type="password" class="input" autocomplete="new-password">` })}
            <div class="field" style="justify-content:flex-end">${check('u-active', 'isActive', 'Active', u ? u.isActive : true)}</div>
          </div></form>`,
          footer: html`<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-usave>Save User</button>`,
        });
        createCombobox(dlg.el.querySelector('#u-emp'), {
          fetch: async (q, signal) => (await api('/employees', { query: { q, pageSize: 8 }, signal })).items,
          renderItem: (e, q) => html`<div class="opt-main">${highlight(e.displayName, q)}</div><div class="opt-sub">${e.designation}</div>`,
          itemLabel: (e) => e.displayName,
          onSelect: (e) => { employeeId = e?.id || null; },
        });
        dlg.el.querySelector('[data-usave]').addEventListener('click', async (ev) => {
          const f = dlg.el.querySelector('[data-uf]');
          const body = { ...formData(f), employeeId, mustChangePassword: u ? undefined : true };
          if (!dlg.el.querySelector('#u-emp').value.trim()) body.employeeId = null;
          setBusy(ev.currentTarget, true, 'Saving…');
          try {
            const r = await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body });
            toast(r.message); dlg.close(); loadUsers();
          } catch (err) { setBusy(ev.currentTarget, false); if (err.fields) { const x = showFieldErrors(f, err.fields, { username: 'u-username', fullName: 'u-name', email: 'u-email', roleCode: 'u-role', employeeId: 'u-emp', password: 'u-pass' }); if (x.length) toast(x[0], 'error'); } else toastError(err); }
        });
      };
      on(panel, 'click', '[data-uadd]', () => userDlg(null));
      on(panel, 'click', '[data-uedit]', (e, b) => userDlg(users.find((u) => u.id === Number(b.dataset.uedit))));
      on(panel, 'click', '[data-uunlock]', async (e, b) => { try { const r = await api(`/users/${b.dataset.uunlock}/unlock`, { method: 'POST' }); toast(r.message); loadUsers(); } catch (err) { toastError(err); } });
      on(panel, 'click', '[data-ureset]', (e, b) => {
        const u = users.find((x) => x.id === Number(b.dataset.ureset));
        const dlg = modal({
          title: `Reset Password – ${u.username}`, size: 'narrow',
          body: html`<form data-rf novalidate>${field({ id: 'r-pass', label: 'New Temporary Password', required: true, help: 'The user will be asked to change it at next sign-in. All their sessions are ended.', control: html`<input id="r-pass" name="password" type="password" class="input" autocomplete="new-password">` })}</form>`,
          footer: html`<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-rsave>Reset Password</button>`,
        });
        dlg.el.querySelector('[data-rsave]').addEventListener('click', async () => {
          const f = dlg.el.querySelector('[data-rf]');
          try { const r = await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { password: f.password.value } }); toast(r.message); dlg.close(); loadUsers(); } catch (err) { if (err.fields) showFieldErrors(f, err.fields, { password: 'r-pass' }); else toastError(err); }
        });
      });
      await loadUsers();
    },

    async watchlist() {
      let rows = [];
      render(panel, html`<div class="card"><div class="card-header"><h2>Blocked / Restricted Visitors</h2>
        <div class="row"><label for="wl-find" class="sr-only">Find visitor to restrict</label><div style="width:340px"><input id="wl-find" class="input" placeholder="Find a visitor to flag or block"></div></div></div>
        <div data-wl>${loadingBlock()}</div></div>`);
      const loadWl = async () => {
        rows = (await api('/visitors', { query: { watchlist: 'true', pageSize: 200 } })).items;
        render($('[data-wl]', panel), dataTable({
          caption: 'Restricted visitors',
          columns: [
            { key: 'n', label: 'Visitor', render: (v) => html`<a class="cell-main" href="/visitors/${v.id}">${v.fullName}</a><div class="cell-sub">${v.visitorCode} · ${v.companyName || 'Individual'}</div>` },
            { key: 's', label: 'Restriction', render: (v) => html`<span class="tag ${v.watchlistStatus === 'BLOCKED' ? 'danger' : 'warning'}">${v.watchlistStatus === 'BLOCKED' ? 'Blocked' : 'Flagged'}</span>` },
            { key: 'r', label: 'Reason', render: (v) => v.watchlistReason },
            { key: 'd', label: 'Since', render: (v) => (v.watchlistUpdatedAt ? fmtDate(v.watchlistUpdatedAt) : '—') },
            { key: 'a', label: html`<span class="sr-only">Actions</span>`, render: (v) => html`<button type="button" class="btn sm" data-wedit="${v.id}">${icon('edit')}Change</button>` },
          ],
          rows,
          empty: emptyState('No restricted visitors', 'Use the search box to flag or block a visitor.', 'shieldCheck'),
        }));
      };
      createCombobox($('#wl-find', panel), {
        minChars: 2,
        fetch: async (q, signal) => (await api('/visitors/search', { query: { q, limit: 8 }, signal })).items,
        renderItem: (v, q) => html`<div class="opt-main">${highlight(v.fullName, q)}</div><div class="opt-sub">${v.companyName || 'Individual'} · ${v.mobileCountryCode} ${v.mobileNumber}</div>`,
        itemLabel: (v) => v.fullName,
        onSelect: (v) => { if (v) watchlistDialog(v, () => { $('#wl-find', panel).value = ''; loadWl(); }); },
      });
      on(panel, 'click', '[data-wedit]', (e, b) => watchlistDialog(rows.find((r) => r.id === Number(b.dataset.wedit)), loadWl));
      await loadWl();
    },

    async retention() {
      const r = data.settings.retention;
      render(panel, html`<form class="card" data-form novalidate>
        <div class="card-header"><h2>Data Retention Policy</h2></div>
        <div class="card-body stack">
          ${alertBox('info', 'Records are never deleted casually', html`Visit transactions are official records and are retained. Visitor master records move from <b>Active</b> to <b>Archived</b> (hidden from returning-visitor search) and later to <b>Anonymised</b> (personal data removed, statistics preserved). Restricted visitors and visitors with open visits are never archived or anonymised.`)}
          <div class="grid cols-2">
            ${field({ id: 'archiveVisitorsAfterDays', label: 'Archive visitors inactive for (days)', control: html`<input id="archiveVisitorsAfterDays" name="archiveVisitorsAfterDays" type="number" class="input" value="${r.archiveVisitorsAfterDays}">` })}
            ${field({ id: 'anonymiseVisitorsAfterDays', label: 'Anonymise visitors inactive for (days)', control: html`<input id="anonymiseVisitorsAfterDays" name="anonymiseVisitorsAfterDays" type="number" class="input" value="${r.anonymiseVisitorsAfterDays}">` })}
            ${field({ id: 'deletePhotosAfterDays', label: 'Delete photographs after inactivity of (days)', control: html`<input id="deletePhotosAfterDays" name="deletePhotosAfterDays" type="number" class="input" value="${r.deletePhotosAfterDays}">` })}
            ${field({ id: 'deleteUnattachedUploadsAfterHours', label: 'Delete abandoned photo uploads after (hours)', control: html`<input id="deleteUnattachedUploadsAfterHours" name="deleteUnattachedUploadsAfterHours" type="number" class="input" value="${r.deleteUnattachedUploadsAfterHours}">` })}
          </div>
        </div>
        <div class="card-footer row"><button type="submit" class="btn primary">Save Policy</button></div></form>
        <section class="card mt-2"><div class="card-header"><h2>Apply Policy</h2></div><div class="card-body" data-preview>${loadingBlock('Calculating…')}</div></section>
        <section class="card mt-2"><div class="card-header"><h2>Database Backup</h2></div><div class="card-body">
          <p class="mb-0">Backups are taken at the database-server level with the provided <code>scripts/backup.sh</code> (pg_dump, compressed, checksummed, with retention) and verified with <code>scripts/verify-backup.sh</code>. Schedule them with cron or a systemd timer as described in <code>docs/BACKUP_AND_RECOVERY.md</code>. This screen does not start backups.</p>
        </div></section>`);
      const showPreview = async () => {
        const p = await api('/retention/preview');
        render($('[data-preview]', panel), html`<div class="inline-list mb-2"><span>Visitors to archive: <b>${p.toArchive}</b></span><span>Visitors to anonymise: <b>${p.toAnonymise}</b></span><span>Photographs to delete: <b>${p.photosToDelete}</b></span></div>
          <button type="button" class="btn danger" data-run ${p.toArchive + p.toAnonymise + p.photosToDelete === 0 ? 'disabled' : ''}>Apply Retention Policy Now</button>`);
      };
      $('[data-form]', panel).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        for (const k of Object.keys(f)) f[k] = Number(f[k]);
        await saveSetting('retention', f, e.submitter);
        showPreview();
      });
      on(panel, 'click', '[data-run]', async (e, b) => {
        if (!(await confirmDialog({ title: 'Apply data retention', message: 'Archive, anonymise and delete photographs according to the policy now? Anonymisation cannot be undone.', confirmLabel: 'Apply Policy', danger: true }))) return;
        setBusy(b, true, 'Applying…');
        try { const res = await api('/retention/run', { method: 'POST', body: { confirm: true } }); toast(`${res.message} ${res.archived} archived, ${res.anonymised} anonymised, ${res.photosDeleted} photographs deleted.`); showPreview(); } catch (err) { toastError(err); setBusy(b, false); }
      });
      await showPreview();
    },
  };

  async function show(key) {
    active = key;
    replaceQuery({ tab: key });
    $$('[data-tab]', root).forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === key)));
    panel.setAttribute('aria-labelledby', `tab-${key}`);
    render(panel, loadingBlock('Loading…'));
    try { await PANELS[key](); } catch (err) { render(panel, emptyState('Unable to load settings', err.message, 'alert')); }
  }

  on(root, 'click', '[data-tab]', (e, b) => show(b.dataset.tab));
  root.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
    const btns = $$('[data-tab]', root);
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus();
      show(n.dataset.tab);
    }
  });
  try { await loadData(); } catch (err) { toastError(err); }
  await show(active);
}
