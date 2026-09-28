/**
 * History-API router. Routes declare the permissions they need; the server
 * enforces the same rules, so this only controls what the user is offered.
 */
import { confirmDialog } from './ui.js';

const routes = [];
let renderRoute = null;
let leaveGuard = null;
let current = null;

export function defineRoutes(list) {
  for (const r of list) {
    const keys = [];
    const pattern = new RegExp(`^${r.path.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}\\/?$`);
    routes.push({ ...r, pattern, keys });
  }
}

export function match(pathname) {
  for (const r of routes) {
    const m = r.pattern.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

/** A page may register a guard (e.g. unsaved form) that must approve leaving. */
export function setLeaveGuard(fn) { leaveGuard = fn; }

async function canLeave() {
  if (!leaveGuard) return true;
  const dirty = leaveGuard();
  if (!dirty) return true;
  return confirmDialog({
    title: 'Unsaved information',
    message: 'The visitor information entered on this screen has not been saved. Leave this screen and discard it?',
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Stay on this screen',
    danger: true,
  });
}

export async function navigate(to, { replace = false, force = false } = {}) {
  const url = new URL(to, window.location.origin);
  if (!force && !(await canLeave())) return false;
  leaveGuard = null;
  if (replace) history.replaceState({}, '', url.pathname + url.search);
  else history.pushState({}, '', url.pathname + url.search);
  await renderRoute?.(url);
  return true;
}

export function currentUrl() { return current; }

export function startRouter(render) {
  renderRoute = async (url) => {
    current = url;
    await render(url);
  };
  window.addEventListener('popstate', async () => {
    if (leaveGuard && leaveGuard()) {
      const ok = await canLeave();
      if (!ok) { history.pushState({}, '', current.pathname + current.search); return; }
    }
    leaveGuard = null;
    renderRoute(new URL(window.location.href));
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('/api/') || a.target || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    e.preventDefault();
    navigate(href);
  });
  renderRoute(new URL(window.location.href));
}

/** Update the query string without re-rendering (filters, tabs). */
export function replaceQuery(params) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) url.searchParams.delete(k);
    else url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  history.replaceState({}, '', url.pathname + url.search);
  current = url;
}

/** Open a print-preview window (keeps the operator's current screen intact). */
export function openPrint(path) {
  // Note: 'noopener' would make window.open() return null, so it is not used;
  // the preview is same-origin and trusted.
  const w = window.open(path, '_blank');
  if (!w) window.location.assign(path);
}
