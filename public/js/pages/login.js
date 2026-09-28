import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { alertBox, clearErrors, showFieldErrors, setBusy } from '../lib/ui.js';

export default async function login(root, { message, onSuccess }) {
  let branding = {};
  try { branding = await api('/auth/branding'); } catch { /* offline: fall back to defaults */ }
  const orgName = branding.name || 'Visitor Management System';
  render(root, html`
    <div class="login-wrap">
      <aside class="login-aside" aria-hidden="true">
        <div>
          <div class="row">
            ${branding.logoUrl ? html`<img src="${branding.logoUrl}" alt="" style="height:44px;background:#fff;border-radius:8px;padding:4px">` : html`<img src="/img/logo-mark.svg" alt="" width="44" height="44">`}
          </div>
          <h1>${orgName}</h1>
          <p style="color:#a9b8cf;font-size:1.02rem;max-width:460px">Visitor Management System — secure registration, host notification, visitor passes and complete visit records.</p>
          <ul>
            <li>${icon('search')}<span>Instant recognition of returning visitors by mobile number, name or organisation</span></li>
            <li>${icon('idCard')}<span>Professional visitor passes and Half-A4 visitor records</span></li>
            <li>${icon('mapPin')}<span>Live on-premises list and emergency roll call</span></li>
            <li>${icon('shieldCheck')}<span>Role-based access with a complete audit trail</span></li>
          </ul>
        </div>
        <div style="font-size:.8rem;color:#7f93b0">Authorised personnel only. All activity is recorded.</div>
      </aside>
      <main class="login-main" id="main">
        <div class="login-card">
          <div class="mb-2">
            <h2>Sign in</h2>
            <div class="muted">Use your Visitor Management System account.</div>
          </div>
          <div data-login-message>${message ? alertBox('warning', '', html`${message}`) : ''}</div>
          <form novalidate data-login-form class="stack mt-2" autocomplete="on">
            <div class="field">
              <label for="login-username">Username</label>
              <input id="login-username" name="username" class="input lg" autocomplete="username" autocapitalize="none" spellcheck="false" required aria-describedby="login-username-error" autofocus>
              <div class="error-text" id="login-username-error" role="alert"></div>
            </div>
            <div class="field">
              <label for="login-password">Password</label>
              <input id="login-password" name="password" type="password" class="input lg" autocomplete="current-password" required aria-describedby="login-password-error">
              <div class="error-text" id="login-password-error" role="alert"></div>
            </div>
            <button type="submit" class="btn primary lg" data-submit>${icon('logIn')}Sign In</button>
          </form>
          <p class="muted mt-3" style="font-size:.8rem">For access or password assistance, contact the system administrator.</p>
        </div>
      </main>
    </div>`);

  const form = $('[data-login-form]', root);
  const msg = $('[data-login-message]', root);
  $('#login-username', root).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const username = form.username.value.trim();
    const password = form.password.value;
    const fields = {};
    if (!username) fields.username = 'Username is required';
    if (!password) fields.password = 'Password is required';
    if (Object.keys(fields).length) { showFieldErrors(form, fields, { username: 'login-username', password: 'login-password' }); return; }
    const btn = $('[data-submit]', form);
    setBusy(btn, true, 'Signing in…');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      await onSuccess(data);
    } catch (err) {
      setBusy(btn, false);
      render(msg, alertBox('danger', '', html`${err.message}`));
      form.password.value = '';
      form.password.focus();
    }
  });
}
