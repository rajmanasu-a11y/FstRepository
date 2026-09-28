import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { session } from '../lib/state.js';
import { field, clearErrors, showFieldErrors, toast, toastError, setBusy } from '../lib/ui.js';

export default async function profile(root) {
  const u = session.user;
  const min = session.settings.security?.passwordMinLength || 10;
  render(root, html`
    <div class="page-header"><div><h1>My Profile</h1><div class="subtitle">${u.fullName} · ${u.roleName} · ${u.username}</div></div></div>
    ${u.mustChangePassword ? html`<div class="alert warning mb-2">${icon('alert')}<div class="alert-body"><div class="alert-title">Password change required</div>Please set a new password before continuing.</div></div>` : ''}
    <form class="card" style="max-width:560px" data-form novalidate>
      <div class="card-header"><h2>Change Password</h2></div>
      <div class="card-body stack">
        ${field({ id: 'cp-current', label: 'Current Password', required: true, control: html`<input id="cp-current" name="currentPassword" type="password" class="input" autocomplete="current-password" aria-describedby="cp-current-error">` })}
        ${field({ id: 'cp-new', label: 'New Password', required: true, help: `At least ${min} characters, including upper- and lowercase letters, a number and a special character.`, control: html`<input id="cp-new" name="newPassword" type="password" class="input" autocomplete="new-password" aria-describedby="cp-new-error cp-new-help">` })}
        ${field({ id: 'cp-confirm', label: 'Confirm New Password', required: true, control: html`<input id="cp-confirm" name="confirmPassword" type="password" class="input" autocomplete="new-password" aria-describedby="cp-confirm-error">` })}
      </div>
      <div class="card-footer"><button type="submit" class="btn primary">${icon('key')}Change Password</button></div>
    </form>`);
  const form = $('[data-form]', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const body = { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value, confirmPassword: form.confirmPassword.value };
    if (body.newPassword !== body.confirmPassword) { showFieldErrors(form, { confirmPassword: 'Passwords do not match' }, { confirmPassword: 'cp-confirm' }); return; }
    const btn = form.querySelector('[type=submit]');
    setBusy(btn, true, 'Saving…');
    try {
      const r = await api('/auth/change-password', { method: 'POST', body });
      toast(r.message);
      session.user.mustChangePassword = false;
      form.reset();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields, { currentPassword: 'cp-current', newPassword: 'cp-new', confirmPassword: 'cp-confirm' }); else toastError(err);
    } finally { setBusy(btn, false); }
  });
}
