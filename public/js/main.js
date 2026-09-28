import { html, render, $ } from './lib/dom.js';
import { api, setUnauthenticatedHandler } from './lib/api.js';
import { session, setSession, clearSession, canAny } from './lib/state.js';
import { defineRoutes, match, startRouter, navigate } from './lib/router.js';
import { emptyState, loadingBlock } from './lib/ui.js';
import { renderShell, updateActiveNav } from './components/shell.js';

// Route table: path, page module, permissions (any-of), document title.
defineRoutes([
  { path: '/', load: () => import('./pages/dashboard.js'), perms: ['dashboard.view'], title: 'Dashboard' },
  { path: '/register', load: () => import('./pages/register.js'), perms: ['visit.create'], title: 'Visitor Registration' },
  { path: '/visitors', load: () => import('./pages/visitors.js'), perms: ['visit.view_all', 'visit.view_own'], title: 'Visitor Search & History' },
  { path: '/visitors/:id', load: () => import('./pages/visitorProfile.js'), perms: ['visitor.view'], title: 'Visitor Profile' },
  { path: '/visits/:id', load: () => import('./pages/visitDetail.js'), perms: ['visit.view_all', 'visit.view_own'], title: 'Visitor Visit Details' },
  { path: '/pre-registration', load: () => import('./pages/prereg.js'), perms: ['prereg.any', 'prereg.own'], title: 'Pre-Registration' },
  { path: '/approvals', load: () => import('./pages/approvals.js'), perms: ['visit.approve_own', 'visit.approve_any'], title: 'Visitor Approvals' },
  { path: '/check-in', load: () => import('./pages/checkin.js'), perms: ['visit.checkin'], title: 'Visitor Check-In' },
  { path: '/check-out', load: () => import('./pages/checkout.js'), perms: ['visit.checkout'], title: 'Visitor Check-Out' },
  { path: '/on-premises', load: () => import('./pages/onPremises.js'), perms: ['onpremises.view'], title: 'Currently On Premises' },
  { path: '/emergency', load: () => import('./pages/emergency.js'), perms: ['emergency.view'], title: 'Emergency Visitor Accountability' },
  { path: '/verify', load: () => import('./pages/verify.js'), perms: ['security.verify', 'visit.checkin'], title: 'Verify Visitor Pass' },
  { path: '/verify/:token', load: () => import('./pages/verify.js'), perms: ['security.verify', 'visit.checkin'], title: 'Verify Visitor Pass' },
  { path: '/reports', load: () => import('./pages/reports.js'), perms: ['report.view'], title: 'Reports & Analytics' },
  { path: '/reports/:type', load: () => import('./pages/reports.js'), perms: ['report.view'], title: 'Reports & Analytics' },
  { path: '/employees', load: () => import('./pages/employees.js'), perms: ['employee.manage'], title: 'Employee / Host Directory' },
  { path: '/companies', load: () => import('./pages/companies.js'), perms: ['company.manage'], title: 'Organisation / Company Directory' },
  { path: '/settings', load: () => import('./pages/settings.js'), perms: ['settings.manage', 'user.manage', 'master.manage', 'retention.manage', 'visitor.watchlist'], title: 'Settings' },
  { path: '/audit', load: () => import('./pages/audit.js'), perms: ['audit.view'], title: 'Audit Logs' },
  { path: '/profile', load: () => import('./pages/profile.js'), perms: [], title: 'My Profile' },
  { path: '/notifications', load: () => import('./pages/notifications.js'), perms: [], title: 'Notifications' },
  // Print previews render without the application chrome.
  { path: '/print/pass/:id', load: () => import('./pages/print.js'), perms: ['pass.print'], title: 'Visitor Pass', bare: true, kind: 'pass' },
  { path: '/print/record/:id', load: () => import('./pages/print.js'), perms: ['pass.print'], title: 'Visitor Record', bare: true, kind: 'record' },
  { path: '/print/invitation/:id', load: () => import('./pages/print.js'), perms: ['prereg.any', 'prereg.own', 'pass.print'], title: 'Visit Invitation', bare: true, kind: 'invitation' },
  { path: '/print/report/:type', load: () => import('./pages/print.js'), perms: ['report.view', 'onpremises.view'], title: 'Report', bare: true, kind: 'report' },
  { path: '/print/emergency', load: () => import('./pages/print.js'), perms: ['emergency.view'], title: 'Emergency Roll Call', bare: true, kind: 'emergency' },
  { path: '/print/visitor/:id', load: () => import('./pages/print.js'), perms: ['visitor.view'], title: 'Visitor History', bare: true, kind: 'visitor' },
]);

const app = document.getElementById('app');
let cleanup = null;
let shellMounted = false;
let renderToken = 0;

async function loadSession() {
  try {
    const me = await api('/auth/me');
    setSession(me);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function showLogin(message) {
  shellMounted = false;
  cleanup?.();
  cleanup = null;
  const { default: login } = await import('./pages/login.js');
  document.title = 'Sign in – Visitor Management System';
  login(app, { message, onSuccess: async (data) => {
    setSession(data);
    const url = new URL(window.location.href);
    const target = url.pathname === '/login' ? '/' : url.pathname + url.search;
    await navigate(target, { replace: true, force: true });
  } });
}

setUnauthenticatedHandler((err) => {
  if (!session.user) return;
  clearSession();
  showLogin(err.code === 'SESSION_EXPIRED' ? err.message : 'Your session has ended. Please sign in again.');
});

function homeFor() {
  // Send each role to its most useful first screen.
  if (canAny('dashboard.view')) return '/';
  return '/profile';
}

async function renderUrl(url) {
  const token = ++renderToken;
  if (!session.user) {
    await showLogin();
    return;
  }
  if (url.pathname === '/login') { navigate(homeFor(), { replace: true, force: true }); return; }
  if (session.user.mustChangePassword && url.pathname !== '/profile') { navigate('/profile', { replace: true, force: true }); return; }
  const found = match(url.pathname);
  cleanup?.();
  cleanup = null;

  if (found?.route.bare) {
    shellMounted = false;
    document.body.classList.add('print-mode');
    if (found.route.perms.length && !canAny(...found.route.perms)) {
      render(app, emptyState('Access restricted', 'You do not have permission to view this document.', 'lock'));
      return;
    }
    const mod = await found.route.load();
    if (token !== renderToken) return;
    cleanup = await mod.default(app, { params: found.params, query: url.searchParams, kind: found.route.kind }) || null;
    return;
  }
  document.body.classList.remove('print-mode');

  if (!shellMounted) {
    renderShell(app);
    shellMounted = true;
  }
  const main = $('#main');
  updateActiveNav(url.pathname);
  if (!found) {
    document.title = 'Page not found – Visitor Management System';
    render(main, html`<div class="page">${emptyState('Page not found', 'The page you requested does not exist. Use the navigation menu to continue.', 'alert')}</div>`);
    return;
  }
  const { route, params } = found;
  if (route.perms.length && !canAny(...route.perms)) {
    document.title = 'Access restricted – Visitor Management System';
    render(main, html`<div class="page">${emptyState('Access restricted', 'Your role does not have access to this screen. Please contact the system administrator if you require access.', 'lock')}</div>`);
    return;
  }
  document.title = `${route.title} – Visitor Management System`;
  render(main, html`<div class="page">${loadingBlock()}</div>`);
  try {
    const mod = await route.load();
    if (token !== renderToken) return;
    const container = document.createElement('div');
    container.className = 'page';
    main.replaceChildren(container);
    cleanup = (await mod.default(container, { params, query: url.searchParams })) || null;
    // Move focus to the page heading for screen-reader users, unless the page focused something itself.
    if (document.activeElement === document.body || !main.contains(document.activeElement)) {
      const h1 = container.querySelector('h1');
      if (h1 && !container.querySelector('[autofocus]')) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    render(main, html`<div class="page">${emptyState('Unable to open this screen', 'Please try again or contact the system administrator.', 'alert')}</div>`);
  }
}

(async function boot() {
  await loadSession();
  startRouter(renderUrl);
})();

export { homeFor };
