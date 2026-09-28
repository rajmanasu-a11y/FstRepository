import { html, render, fragment, $, $$, focusables, uid, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { GENERIC_ERROR } from './api.js';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const TOAST_ICONS = { success: 'checkCircle', error: 'xCircle', warning: 'alert', info: 'info' };

export function toast(message, type = 'success', { timeout = 5000 } = {}) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(el, html`${icon(TOAST_ICONS[type] || 'info')}<div>${message}</div><button type="button" aria-label="Dismiss notification">${icon('x')}</button>`);
  root.appendChild(el);
  const remove = () => el.remove();
  el.querySelector('button').addEventListener('click', remove);
  if (timeout) setTimeout(remove, type === 'error' ? timeout * 1.6 : timeout);
}

export function toastError(err) {
  toast(err?.message || GENERIC_ERROR, 'error');
}

// ---------------------------------------------------------------------------
// Modal dialog with focus trap, ESC to close and focus restoration.
// ---------------------------------------------------------------------------
const openModals = [];

export function modal({ title, body, footer, size = '', onClose, initialFocus, dismissible = true, labelledBy }) {
  const root = document.getElementById('modal-root');
  const titleId = labelledBy || uid('modal-title');
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  render(backdrop, html`
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-header">
        <h2 id="${titleId}">${title}</h2>
        ${dismissible ? html`<button type="button" class="btn ghost sm icon" data-close aria-label="Close dialog">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-footer">${footer}</div>` : ''}
    </div>`);
  root.appendChild(backdrop);
  const dialog = backdrop.querySelector('.modal');
  // Make the rest of the page inert while the dialog is open.
  const app = document.getElementById('app');
  app.setAttribute('inert', '');
  app.setAttribute('aria-hidden', 'true');

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    openModals.splice(openModals.indexOf(api), 1);
    if (!openModals.length) {
      app.removeAttribute('inert');
      app.removeAttribute('aria-hidden');
    }
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  };
  const onKey = (e) => {
    if (openModals[openModals.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) {
      // Let an open combobox list consume ESC first.
      if (e.target.getAttribute?.('aria-expanded') === 'true') return;
      e.preventDefault();
      e.stopPropagation();
      close(null);
    } else if (e.key === 'Tab') {
      const items = focusables(dialog);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(null); });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', () => close(null)));
  const api = { el: dialog, close };
  openModals.push(api);
  requestAnimationFrame(() => {
    const target = (initialFocus && $(initialFocus, dialog)) || focusables($('.modal-body', dialog))[0] || focusables(dialog)[0];
    target?.focus();
  });
  return api;
}

export function confirmDialog({ title = 'Please confirm', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      size: 'narrow',
      body: html`<p class="mb-0">${message}</p>`,
      footer: html`<button type="button" class="btn" data-cancel>${cancelLabel}</button>
                   <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirmLabel}</button>`,
      initialFocus: '[data-ok]',
      onClose: (r) => resolve(Boolean(r)),
    });
    m.el.querySelector('[data-cancel]').addEventListener('click', () => m.close(false));
    m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  });
}

/** Ask for a short text (e.g. a reason). Resolves to the text or null. */
export function promptDialog({ title, label, help, confirmLabel = 'Submit', danger = false, required = true, maxLength = 300, initial = '' }) {
  return new Promise((resolve) => {
    const id = uid('prompt');
    const m = modal({
      title,
      size: 'narrow',
      body: html`<form id="${id}-form" novalidate>
        <div class="field">
          <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
          <textarea id="${id}" class="textarea" maxlength="${maxLength}" ${required ? 'required' : ''} aria-describedby="${id}-error ${id}-help">${initial}</textarea>
          ${help ? html`<div class="help" id="${id}-help">${help}</div>` : ''}
          <div class="error-text" id="${id}-error" role="alert"></div>
        </div></form>`,
      footer: html`<button type="button" class="btn" data-cancel>Cancel</button>
                   <button type="submit" form="${id}-form" class="btn ${danger ? 'danger' : 'primary'}">${confirmLabel}</button>`,
      onClose: (r) => resolve(r ?? null),
    });
    const input = m.el.querySelector('textarea');
    m.el.querySelector('[data-cancel]').addEventListener('click', () => m.close(null));
    m.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (required && v.length < 3) {
        input.setAttribute('aria-invalid', 'true');
        m.el.querySelector(`#${id}-error`).textContent = 'Please enter at least 3 characters.';
        input.focus();
        return;
      }
      m.close(v);
    });
  });
}

// ---------------------------------------------------------------------------
// Inline field validation helpers
// ---------------------------------------------------------------------------
export function clearErrors(form) {
  $$('[aria-invalid="true"]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $$('.error-text', form).forEach((el) => { el.textContent = ''; });
}

/**
 * Show server/client field errors next to their controls. `map` translates
 * API field names to element ids. Focuses the first invalid control.
 */
export function showFieldErrors(form, fields, map = {}) {
  clearErrors(form);
  let first = null;
  const unmatched = [];
  for (const [name, message] of Object.entries(fields || {})) {
    const id = map[name] || name;
    const control = form.querySelector(`#${CSS.escape(id)}`) || form.querySelector(`[name="${CSS.escape(name)}"]`);
    const errorEl = control && (form.querySelector(`#${CSS.escape(control.id)}-error`) || control.closest('.field')?.querySelector('.error-text'));
    if (control && errorEl) {
      control.setAttribute('aria-invalid', 'true');
      errorEl.textContent = message;
      if (!first) first = control;
    } else {
      unmatched.push(message);
    }
  }
  if (first) {
    first.focus();
    first.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  return unmatched;
}

export function setFieldError(form, id, message) {
  const control = form.querySelector(`#${CSS.escape(id)}`);
  const errorEl = form.querySelector(`#${CSS.escape(id)}-error`);
  if (control) control.toggleAttribute('aria-invalid', Boolean(message));
  if (control && message) control.setAttribute('aria-invalid', 'true');
  if (errorEl) errorEl.textContent = message || '';
}

// ---------------------------------------------------------------------------
// Standard fragments
// ---------------------------------------------------------------------------
export const loadingBlock = (text = 'Loading…') => html`<div class="loading-block" role="status"><span class="spinner" aria-hidden="true"></span>${text}</div>`;

export const emptyState = (title, hint = '', iconName = 'inbox') => html`
  <div class="empty" role="status">${icon(iconName)}<div class="empty-title">${title}</div>${hint ? html`<div class="empty-hint">${hint}</div>` : ''}</div>`;

export const alertBox = (type, title, body = '', actions = '') => html`
  <div class="alert ${type}" role="${type === 'danger' || type === 'warning' ? 'alert' : 'status'}">
    ${icon(type === 'success' ? 'checkCircle' : type === 'danger' ? 'shieldAlert' : type === 'warning' ? 'alert' : 'info')}
    <div class="alert-body">${title ? html`<div class="alert-title">${title}</div>` : ''}${body}${actions ? html`<div class="alert-actions">${actions}</div>` : ''}</div>
  </div>`;

/** Field markup helper: consistent label / control / help / error wiring. */
export function field({ id, label, required = false, help = '', control, cls = '' }) {
  return html`<div class="field ${cls}">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span>` : ''}</label>
    ${control}
    ${help ? html`<div class="help" id="${id}-help">${help}</div>` : ''}
    <div class="error-text" id="${id}-error" role="alert"></div>
  </div>`;
}

export const describedBy = (id, help = false) => `${id}-error${help ? ` ${id}-help` : ''}`;

export function options(list, selected, { placeholder, valueKey = 'id', labelKey = 'name' } = {}) {
  return html`${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}${list.map((o) => {
    const v = typeof o === 'object' ? o[valueKey] : o;
    const l = typeof o === 'object' ? o[labelKey] : o;
    return html`<option value="${v}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${l}</option>`;
  })}`;
}

export function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (busyText) render(button, html`<span class="spinner sm" aria-hidden="true"></span>${busyText}`);
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

export function highlight(text, query) {
  const s = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q || q.length < 2) return html`${s}`;
  const idx = s.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return html`${s}`;
  return html`${s.slice(0, idx)}<mark>${s.slice(idx, idx + q.length)}</mark>${s.slice(idx + q.length)}`;
}

export { fragment, escapeHtml };
