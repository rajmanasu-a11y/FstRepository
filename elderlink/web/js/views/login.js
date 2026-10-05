// Welcome, demo personas and OTP sign-in / sign-up with itemised DPDP consent (FR-ONB-01, 02).
import { api } from '../api.js';
import { t } from '../i18n.js';
import { h, icon, toast, formData } from '../ui.js';

export async function view({ onSignedIn }) {
  const [personas, purposes] = await Promise.all([api.get('/auth/personas'), api.get('/auth/consent-purposes')]);
  const html = h`
    <section class="hero">
      <h1>${t('Trusted care for your parents, near their home')}</h1>
      <p>${t('Verified nurses, hospitals and helpers with clear minimum prices and real reviews. Plus medicine reminders, monthly check visits and 24x7 SOS.')}</p>
    </section>
    <div class="section-title"><h2>${t('Try the demo as')}</h2></div>
    <p class="muted">${t('Pick a person to see the app from their side. Everything is sample data; no real payments, SMS or calls.')}</p>
    <div class="persona-grid">
      ${personas.map((p) => h`<button class="persona" data-as="${p.id}"><span class="ic">${icon(p.icon || 'user', 28)}</span><span><strong>${p.name}</strong><span class="badge brand">${t(p.title)}</span><br><span class="muted">${t(p.blurb)}</span></span></button>`)}
    </div>
    <div class="card" style="margin-top:20px">
      <h2>${t('Sign in or create an account')}</h2>
      <form id="otp-form" novalidate>
        <label for="mobile">${t('Mobile number')} <span class="hint">${t('Indian or international')}</span></label>
        <input id="mobile" name="mobile" inputmode="tel" autocomplete="tel" placeholder="98860 12345" required>
        <button class="btn block" style="margin-top:12px">${t('Send OTP')}</button>
      </form>
      <form id="verify-form" hidden novalidate>
        <p id="otp-note" class="alert"></p>
        <label for="code">${t('Enter the 6-digit code')}</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
        <div id="new-user" hidden>
          <label for="name">${t('Your name')}</label>
          <input id="name" name="name" autocomplete="name">
          <label>${t('I am')}</label>
          <div class="stack">
            ${[['family', 'A family member arranging care for a parent'], ['senior', 'A senior citizen (60+)'], ['caregiver', 'A nurse, attendant, physio or helper'], ['provider_admin', 'A hospital, nursing home or agency']].map(([v, l], i) => h`<label class="check"><input type="radio" name="role" value="${v}" ${i === 0 ? 'checked' : ''}> ${t(l)}</label>`)}
          </div>
          <fieldset class="card flat" style="margin-top:12px">
            <legend><strong>${t('Your consent')}</strong></legend>
            <p class="muted">${t('We ask separately for each use of your data. You can withdraw any time from Settings.')}</p>
            ${purposes.map((p) => h`<label class="check"><input type="checkbox" name="c_${p.id}" ${p.required ? 'checked disabled' : ''}> ${t(p.label)} ${p.required ? h`<span class="hint">(${t('needed to use ElderLink')})</span>` : h`<span class="hint">(${t('optional')})</span>`}</label>`)}
            <label class="check"><input type="checkbox" name="agree" required> ${t('I agree to the required uses above')}</label>
            <p class="muted" style="font-size:.88rem">${t('ElderLink coordinates care and emergencies; it does not provide ambulance or medical treatment itself.')}</p>
          </fieldset>
        </div>
        <button class="btn block" style="margin-top:12px">${t('Continue')}</button>
      </form>
    </div>`;
  return {
    html,
    mount(el) {
      el.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', async () => {
        try { onSignedIn(await api.post('/auth/demo', { userId: b.dataset.as })); } catch (e) { toast(e.message, true); }
      }));
      let mobile = '';
      el.querySelector('#otp-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        mobile = el.querySelector('#mobile').value;
        try {
          const r = await api.post('/auth/otp', { mobile });
          el.querySelector('#otp-form').hidden = true;
          el.querySelector('#verify-form').hidden = false;
          el.querySelector('#otp-note').textContent = `${t('Code sent by SMS.')} ${t('Demo code')}: ${r.demoCode}`;
          el.querySelector('#new-user').hidden = r.existing;
          el.querySelector('#code').focus();
        } catch (err) { toast(err.message, true); }
      });
      el.querySelector('#verify-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const consents = { marketing: !!f.c_marketing };
        try {
          const s = await api.post('/auth/verify', { mobile, code: f.code, name: f.name, role: f.role, consents, consentGiven: !!f.agree, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
          onSignedIn(s);
        } catch (err) { toast(err.message, true); }
      });
    },
  };
}
