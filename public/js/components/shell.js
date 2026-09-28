import { html, render, $, $$, initials, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { session, can, canAny, org } from '../lib/state.js';
import { navigate } from '../lib/router.js';
import { relativeTime } from '../lib/format.js';
import { toast, emptyState } from '../lib/ui.js';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', perms: ['dashboard.view'] },
  { href: '/register', label: 'Registration', icon: 'userPlus', perms: ['visit.create'] },
  { href: '/visitors', label: 'Visitors', icon: 'history', perms: ['visit.view_all', 'visit.view_own'], hideFor: ['HOST'] },
  { href: '/pre-registration', label: 'Pre-Registration', icon: 'calendarCheck', perms: ['prereg.any', 'prereg.own'] },
  { href: '/approvals', label: 'Approvals', icon: 'userCheck', perms: ['visit.approve_own', 'visit.approve_any'] },
  { href: '/check-in', label: 'Check-In', icon: 'logIn', perms: ['visit.checkin'] },
  { href: '/check-out', label: 'Check-Out', icon: 'logOut', perms: ['visit.checkout'] },
  { href: '/on-premises', label: 'On Premises', icon: 'mapPin', perms: ['onpremises.view'] },
  { href: '/verify', label: 'Verify Pass', icon: 'qr', perms: ['security.verify'], onlyWithout: 'visit.create' },
  { href: '/visitors', label: 'My Visitors', icon: 'history', perms: ['visit.view_own'], onlyFor: ['HOST'] },
  { href: '/reports', label: 'Reports', icon: 'chart', perms: ['report.view'] },
  { href: '/employees', label: 'Hosts', icon: 'users', perms: ['employee.manage'] },
  { href: '/companies', label: 'Companies', icon: 'building', perms: ['company.manage'] },
  { href: '/settings', label: 'Settings', icon: 'settings', perms: ['settings.manage', 'user.manage', 'master.manage'] },
  { href: '/audit', label: 'Audit Logs', icon: 'shield', perms: ['audit.view'] },
];

function visibleNav() {
  const role = session.user.roleCode;
  return NAV.filter((n) => canAny(...n.perms)
    && !(n.hideFor || []).includes(role)
    && (!n.onlyFor || n.onlyFor.includes(role))
    && !(n.onlyWithout && can(n.onlyWithout)));
}

let pollTimer = null;

export function renderShell(root) {
  const u = session.user;
  const o = org();
  render(root, html`
    <header class="app-header">
      <div class="header-bar">
        <button type="button" class="header-btn nav-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="main-nav" data-nav-toggle>${icon('menu')}</button>
        <a href="/" class="brand" aria-label="${o.name || 'Visitor Management System'} – home">
          ${o.logoUrl ? html`<img src="${o.logoUrl}" alt="">` : html`<img class="mark" src="/img/logo-mark.svg" alt="">`}
          <span class="brand-text"><span class="brand-name">${o.name || 'Visitor Management System'}</span><span class="brand-sub">Visitor Management System</span></span>
        </a>
        <div class="header-spacer"></div>
        <div class="header-actions">
          ${can('emergency.view') ? html`<a href="/emergency" class="header-btn emergency" title="Emergency Visitor Accountability">${icon('siren')}<span class="label">Emergency Roll Call</span></a>` : ''}
          <div class="rel">
            <button type="button" class="header-btn" data-notif-toggle aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
              ${icon('bell')}<span class="badge-count" data-notif-count hidden></span>
            </button>
            <div class="menu notif-panel" data-notif-panel hidden></div>
          </div>
          <div class="rel">
            <button type="button" class="header-btn user-chip" data-user-toggle aria-haspopup="true" aria-expanded="false" aria-label="User menu for ${u.fullName}">
              <span class="avatar" aria-hidden="true">${initials(u.fullName)}</span>
              <span class="user-meta"><b>${u.fullName}</b><span>${u.roleName}</span></span>
              ${icon('chevronDown')}
            </button>
            <div class="menu" data-user-menu hidden role="menu">
              <div class="menu-head"><div class="strong">${u.fullName}</div><div class="muted" style="font-size:.82rem">${u.roleName} · ${u.username}</div></div>
              <a href="/profile" role="menuitem">${icon('key')}My Profile &amp; Password</a>
              <a href="/notifications" role="menuitem">${icon('bell')}Notifications</a>
              <button type="button" role="menuitem" data-logout>${icon('logOut')}Sign Out</button>
            </div>
          </div>
        </div>
      </div>
      <nav class="main-nav" id="main-nav" aria-label="Main navigation">
        <ul>${visibleNav().map((n) => html`<li><a href="${n.href}" data-nav="${n.href}">${icon(n.icon)}${n.label}</a></li>`)}</ul>
      </nav>
    </header>
    <main id="main" tabindex="-1"></main>`);

  const header = $('.app-header', root);
  const closeMenus = () => {
    $$('[data-user-menu], [data-notif-panel]', header).forEach((m) => { m.hidden = true; });
    $$('[data-user-toggle], [data-notif-toggle]', header).forEach((b) => b.setAttribute('aria-expanded', 'false'));
  };
  on(header, 'click', '[data-user-toggle]', (e, btn) => {
    const menu = $('[data-user-menu]', header);
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('a,button')?.focus();
  });
  on(header, 'click', '[data-notif-toggle]', async (e, btn) => {
    const panel = $('[data-notif-panel]', header);
    const open = panel.hidden;
    closeMenus();
    if (!open) return;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    await loadNotifications(panel);
  });
  on(header, 'click', '[data-nav-toggle]', (e, btn) => {
    const nav = $('#main-nav', root);
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
  on(header, 'click', '[data-logout]', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.assign('/');
  });
  on(header, 'click', '.menu a', () => closeMenus());
  on(header, 'click', '.main-nav a', () => { $('#main-nav', root).classList.remove('open'); });
  on(header, 'click', '[data-notif-read-all]', async () => {
    await api('/notifications/read-all', { method: 'POST' });
    closeMenus();
    refreshCount();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.rel')) closeMenus(); });
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openBtn = $('[aria-expanded="true"][data-user-toggle], [aria-expanded="true"][data-notif-toggle]', header);
      if (openBtn) { closeMenus(); openBtn.focus(); }
    }
  });

  refreshCount();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshCount, 60_000);
}

async function refreshCount() {
  if (!session.user) { clearInterval(pollTimer); return; }
  try {
    const { unread } = await api('/notifications/unread-count');
    const badge = $('[data-notif-count]');
    if (!badge) return;
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    $('[data-notif-toggle]')?.setAttribute('aria-label', `Notifications${unread ? ` (${unread} unread)` : ''}`);
  } catch { /* handled globally */ }
}

async function loadNotifications(panel) {
  render(panel, html`<div class="loading-block"><span class="spinner sm"></span>Loading notifications…</div>`);
  try {
    const { items, unread } = await api('/notifications');
    render(panel, html`
      <div class="menu-head row between"><b>Notifications</b>${unread ? html`<button type="button" class="btn ghost sm" data-notif-read-all style="width:auto">Mark all as read</button>` : ''}</div>
      ${items.length ? items.slice(0, 15).map((n) => html`
        <div class="notif-item ${n.readAt ? '' : 'unread'}">
          <div class="n-title">${n.title}</div>
          <div class="n-body">${n.body.split('\n').slice(2, 6).join('\n')}</div>
          <div class="n-time">${relativeTime(n.createdAt)}${n.visitId && canAny('visit.view_all', 'visit.view_own') ? html` · <a href="/visits/${n.visitId}">View visit</a>` : ''}</div>
        </div>`) : emptyState('No notifications', 'Visitor arrivals and approval requests will appear here.', 'bell')}
      <div style="padding:8px 12px"><a href="/notifications">View all notifications</a></div>`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function updateActiveNav(pathname) {
  $$('[data-nav]').forEach((a) => {
    const href = a.dataset.nav;
    const active = href === '/' ? pathname === '/' : (pathname === href || pathname.startsWith(`${href}/`));
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const nav = $('#main-nav');
  nav?.classList.remove('open');
}

export { refreshCount, navigate };
