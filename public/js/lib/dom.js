/**
 * Minimal, XSS-safe templating. Every interpolated value is HTML-escaped
 * unless it is itself a SafeHtml produced by html`` or raw().
 */
export class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escapeHtml = (v) => String(v).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

/** Trusted markup only (icons, static fragments). Never pass user data. */
export const raw = (s) => new SafeHtml(String(s));

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export function render(el, content) {
  el.innerHTML = renderValue(content);
  return el;
}

export function fragment(content) {
  const t = document.createElement('template');
  t.innerHTML = renderValue(content);
  return t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener; returns an unsubscribe function. */
export function on(root, event, selector, handler, options) {
  const fn = (e) => {
    const target = e.target.closest?.(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, fn, options);
  return () => root.removeEventListener(event, fn, options);
}

export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

let seq = 0;
export const uid = (prefix = 'id') => `${prefix}-${++seq}`;

export function initials(name = '') {
  return name.replace(/^(Mr|Ms|Mrs|Dr|Prof|Shri|Smt|Adv)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/** Read a form into a plain object; checkboxes -> booleans, empty strings kept. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type !== 'button' && el.type !== 'submit' && el.type !== 'file') out[el.name] = el.value.trim();
  }
  return out;
}

/** Visible, enabled, tabbable elements inside root, in DOM (tab) order. */
export function focusables(root) {
  return $$('a[href], button, input, select, textarea, [tabindex]', root).filter((el) => {
    if (el.disabled || el.getAttribute('tabindex') === '-1' || el.type === 'hidden') return false;
    if (el.closest('[hidden], [inert]')) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
  });
}
