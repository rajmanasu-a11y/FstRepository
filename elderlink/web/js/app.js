// App shell: session, routing, navigation per role, accessibility settings and demo controls.
import { api, init, setToken, getToken, getMode, resetLocal } from './api.js';
import { t, setLang, lang } from './i18n.js';
import { h, str, icon, toast, modal, esc, fmtDateTime, ago } from './ui.js';
import * as login from './views/login.js';
import * as senior from './views/senior.js';
import * as family from './views/family.js';
import * as care from './views/care.js';
import * as caregiver from './views/caregiver.js';
import * as provider from './views/provider.js';
import * as ops from './views/ops.js';
import * as admin from './views/admin.js';
import * as common from './views/common.js';

export const state = { user: null, unread: 0, now: Date.now(), compare: [], seniorId: null, offline: false };

const NAV = {
  family: [['#/home', 'Home', 'home'], ['#/find', 'Find care', 'search'], ['#/bookings', 'Bookings', 'calendar'], ['#/meds', 'Medicines', 'pill'], ['#/more', 'More', 'menu']],
  caregiver: [['#/cg', 'Today', 'home'], ['#/cg/listings', 'My services', 'clipboard'], ['#/cg/earnings', 'Earnings', 'wallet'], ['#/cg/academy', 'Academy', 'star'], ['#/cg/profile', 'Profile', 'id']],
  provider_admin: [['#/prv', 'Dashboard', 'home'], ['#/prv/bookings', 'Bookings', 'calendar'], ['#/prv/staff', 'Staff', 'users'], ['#/cg/listings', 'Services', 'clipboard'], ['#/cg/earnings', 'Payouts', 'wallet']],
  coordinator: [['#/ops', 'Overview', 'home'], ['#/ops/desk', 'SOS desk', 'siren'], ['#/ops/verify', 'Verification', 'id'], ['#/ops/checks', 'Check visits', 'calendar'], ['#/ops/quality', 'Quality', 'shield'], ['#/ops/grievances', 'Complaints', 'chat'], ['#/admin', 'Reports', 'chart']],
  emergency: [['#/ops/desk', 'SOS desk', 'siren'], ['#/ops', 'Overview', 'home']],
  admin: [['#/admin', 'Reports', 'chart'], ['#/admin/config', 'Rules and prices', 'settings'], ['#/admin/catalogue', 'Catalogue', 'clipboard'], ['#/ops', 'Operations', 'home'], ['#/ops/desk', 'SOS desk', 'siren'], ['#/admin/audit', 'Audit log', 'eye']],
  senior: [],
};
const HOME = { family: '#/home', senior: '#/senior', caregiver: '#/cg', provider_admin: '#/prv', coordinator: '#/ops', emergency: '#/ops/desk', admin: '#/admin' };

// [pattern, module, export]
const ROUTES = [
  ['senior', senior, 'home'], ['senior/meds', senior, 'meds'], ['senior/visit', senior, 'visit'], ['senior/family', senior, 'familyCall'], ['senior/more', senior, 'more'],
  ['senior/help', senior, 'askHelp'], ['senior/scam', senior, 'scam'], ['senior/rate/:id', senior, 'rate'], ['senior/sos', senior, 'sosLive'], ['senior/events', senior, 'events'],
  ['home', family, 'home'], ['senior-profile/:id', family, 'seniorProfile'], ['add-senior', family, 'addSenior'], ['find', family, 'find'], ['listing/:id', family, 'listing'], ['provider/:id', family, 'providerProfile'],
  ['book/:id', family, 'book'], ['compare', family, 'compare'], ['bookings', family, 'bookings'], ['booking/:id', common, 'booking'], ['review/:id', family, 'review'],
  ['plans/:id', care, 'plans'], ['meds', care, 'medsIndex'], ['meds/:id', care, 'meds'], ['medchart/:id', care, 'medchart'], ['vitals/:id', care, 'vitals'], ['case/:id', common, 'caseView'],
  ['circle/:id', care, 'circle'], ['careplan/:id', care, 'careplan'], ['wallet', care, 'wallet'], ['invoice/:id', common, 'invoice'], ['more', family, 'more'], ['summary/:id', care, 'summary'],
  ['equipment', family, 'equipment'], ['events', family, 'events'], ['schemes', family, 'schemes'], ['vault/:id', family, 'vault'], ['scam', family, 'scamCentre'], ['programs', family, 'programs'], ['safety/:id', family, 'safety'],
  ['cg', caregiver, 'home'], ['cg/visit/:id', caregiver, 'visit'], ['cg/listings', caregiver, 'listings'], ['cg/earnings', caregiver, 'earnings'], ['cg/academy', caregiver, 'academy'], ['cg/profile', caregiver, 'profile'],
  ['prv', provider, 'home'], ['prv/bookings', provider, 'bookings'], ['prv/staff', provider, 'staff'], ['prv/reviews', provider, 'reviews'],
  ['ops', ops, 'home'], ['ops/desk', ops, 'desk'], ['ops/case/:id', ops, 'deskCase'], ['ops/verify', ops, 'verify'], ['ops/checks', ops, 'checks'], ['ops/quality', ops, 'quality'], ['ops/grievances', ops, 'grievances'],
  ['admin', admin, 'reports'], ['admin/config', admin, 'config'], ['admin/catalogue', admin, 'catalogue'], ['admin/audit', admin, 'audit'],
  ['notifications', common, 'notifications'], ['settings', common, 'settings'], ['help', common, 'help'],
];

function match(hash) {
  const [path, qs] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  for (const [pat, mod, fn] of ROUTES) {
    const pp = pat.split('/');
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) {
      return { view: mod[fn], params, query: Object.fromEntries(new URLSearchParams(qs || '')), path };
    }
  }
  return null;
}

export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
export async function refresh() { await render(true); }

function applyPrefs() {
  const u = state.user;
  const p = u?.prefs || {};
  const root = document.documentElement;
  setLang(u?.language || localPref('lang') || 'en');
  const senior = u ? (u.role === 'senior' ? p.seniorMode !== false : !!p.seniorMode) : false;
  document.body.classList.toggle('senior-mode', senior);
  document.body.classList.toggle('size-xl', p.textSize === 'xl');
  document.body.classList.toggle('size-xxl', p.textSize === 'xxl');
  root.classList.toggle('hc', !!p.contrast);
  const theme = p.theme || localPref('theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  if (!senior) document.documentElement.style.setProperty('--scale', p.textSize === 'xl' ? '1.12' : p.textSize === 'xxl' ? '1.25' : '1');
  else document.documentElement.style.removeProperty('--scale');
}
function localPref(k) { try { return localStorage.getItem('elderlink.' + k); } catch { return null; } }

function shell(contentHtml, path) {
  const u = state.user;
  const nav = u ? NAV[u.role] || [] : [];
  const cur = '#/' + path;
  const on = (href) => (cur === href || (href !== '#/' && cur.startsWith(href + '/')) ? 'on' : '');
  const seniorMode = document.body.classList.contains('senior-mode');
  return str(h`
  <a class="skip" href="#main">${t('Skip to content')}</a>
  <div class="app">
    ${u && nav.length ? h`<nav class="side" aria-label="${t('Main menu')}">
      <a class="brand" href="${HOME[u.role]}"><span class="logo">${icon('heart', 20)}</span>ElderLink</a>
      ${nav.map(([href, label, ic]) => h`<a class="nav ${on(href)}" href="${href}">${icon(ic, 22)} ${t(label)}</a>`)}
      <div style="flex:1"></div>
      <a class="nav ${on('#/settings')}" href="#/settings">${icon('settings', 22)} ${t('Settings')}</a>
    </nav>` : ''}
    <div class="main-wrap">
      <header class="topbar">
        <a class="brand" href="${u ? HOME[u.role] : '#/'}"><span class="logo">${icon('heart', 18)}</span>ElderLink</a>
        ${u ? h`<span class="who">${u.name}</span>` : ''}
        <span class="spacer"></span>
        <button class="iconbtn" data-lang title="${t('Language')}" aria-label="${t('Change language')}"><strong>${lang() === 'hi' ? 'EN' : 'हिं'}</strong></button>
        ${u ? h`<a class="iconbtn" href="#/notifications" aria-label="${t('Notifications')}">${icon('bell')}${state.unread ? h`<span class="dot">${state.unread > 9 ? '9+' : state.unread}</span>` : ''}</a>
        <a class="iconbtn" href="#/settings" aria-label="${t('Settings')}">${icon(seniorMode ? 'text' : 'settings')}</a>` : ''}
      </header>
      <main id="main" tabindex="-1"><div id="view"></div></main>
    </div>
  </div>
  ${u && nav.length ? h`<nav class="bottomnav" aria-label="${t('Main menu')}">${nav.slice(0, 5).map(([href, label, ic]) => h`<a class="${on(href)}" href="${href}">${icon(ic, 24)}<span>${t(label)}</span></a>`)}</nav>` : ''}
  <button class="demo-fab no-print" data-demo>${icon('clock', 18)} ${t('Demo')}</button>
  `).replace('<div id="view"></div>', `<div id="view">${contentHtml}</div>`);
}

let rendering = 0;
async function render(keepScroll = false) {
  const my = ++rendering;
  const root = document.getElementById('root');
  const hash = location.hash || '';
  if (!state.user) {
    if (!/^#\/(signup|login)?$/.test(hash) && hash) { /* any deep link goes to login first */ }
    const out = await login.view({ go, refresh, state, onSignedIn });
    if (my !== rendering) return;
    applyPrefs();
    root.innerHTML = shell(str(out.html), 'login');
    bindShell(root);
    out.mount?.(root.querySelector('#view'));
    return;
  }
  let m = match(hash);
  if (!m) { location.replace(HOME[state.user.role] || '#/home'); return; }
  if (state.user.role === 'senior' && !m.path.startsWith('senior') && !['booking', 'settings', 'notifications', 'help', 'case'].some((p) => m.path.startsWith(p))) { location.replace('#/senior'); return; }
  const view = document.getElementById('view');
  if (view && !keepScroll) view.innerHTML = `<div class="loading">${esc(t('Loading...'))}</div>`;
  try {
    const [clock, me] = await Promise.all([api.get('/demo/clock').catch(() => ({ now: Date.now() })), api.get('/me')]);
    state.now = clock.now; state.unread = me.unread; state.user = me.user;
    const ctx = { params: m.params, query: m.query, path: m.path, go, refresh, state, user: state.user, now: state.now };
    const out = await m.view(ctx);
    if (my !== rendering) return;
    applyPrefs();
    const y = window.scrollY;
    root.innerHTML = shell(str(out.html), m.path);
    bindShell(root);
    document.title = (out.title ? t(out.title) + ' · ' : '') + 'ElderLink';
    out.mount?.(root.querySelector('#view'), ctx);
    if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); root.querySelector('#main')?.focus({ preventScroll: true }); }
  } catch (e) {
    if (e.status === 401) { setToken(null); state.user = null; return render(); }
    root.querySelector('#view').innerHTML = str(h`<div class="card"><h2>${t('Sorry, something went wrong')}</h2><p>${e.message}</p><a class="btn" href="${HOME[state.user?.role] || '#/'}">${t('Go home')}</a></div>`);
    console.error(e);
  }
}

function bindShell(root) {
  root.querySelector('[data-lang]')?.addEventListener('click', async () => {
    const next = lang() === 'hi' ? 'en' : 'hi';
    try { localStorage.setItem('elderlink.lang', next); } catch { /* ignore */ }
    if (state.user) { state.user = await api.patch('/me', { language: next }); }
    setLang(next);
    render(true);
  });
  root.querySelector('[data-demo]')?.addEventListener('click', demoPanel);
}

async function onSignedIn(session) {
  setToken(session.token);
  state.user = session.user;
  location.hash = HOME[session.user.role] || '#/home';
  render();
}

export async function signOut() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setToken(null);
  state.user = null;
  location.hash = '';
  render();
}

async function demoPanel() {
  const clock = await api.get('/demo/clock');
  const personas = await api.get('/auth/personas');
  const close = modal(h`
    <h2>${icon('clock')} ${t('Demo controls')}</h2>
    <p class="muted">${t('Payments, SMS, WhatsApp and calls are simulated. Use these controls to switch person and move time forward to see reminders, alerts and payouts happen.')}</p>
    <div class="card flat"><strong>${t('Demo time')}:</strong> ${fmtDateTime(clock.now)} <span class="muted">(IST)</span>
      <div class="chips" style="margin-top:.6rem">
        ${[[15, '+15 min'], [60, '+1 hour'], [240, '+4 hours'], [1440, '+1 day'], [4320, '+3 days']].map(([m, l]) => h`<button class="chip" data-adv="${m}">${l}</button>`)}
      </div>
    </div>
    <h3>${t('Switch person')}</h3>
    <div class="stack">${personas.map((p) => h`<button class="persona" data-as="${p.id}" style="padding:10px"><span class="ic" style="width:40px;height:40px">${icon(p.icon || 'user', 20)}</span><span><strong>${p.name}</strong><span class="muted">${p.title}</span></span></button>`)}</div>
    <h3 style="margin-top:1rem">${t('More')}</h3>
    <div class="stack">
      <button class="btn soft block" data-outbox>${icon('phone', 20)} ${t('Phone messages (SMS, WhatsApp, calls)')}</button>
      <label class="check"><input type="checkbox" data-offline ${state.offline ? 'checked' : ''}> ${t('Simulate no mobile data (SOS falls back to SMS and call)')}</label>
      <button class="btn ghost block" data-reset>${icon('refresh', 20)} ${t('Reset demo data')}</button>
      <p class="muted" style="font-size:.85rem">${getMode() === 'local' ? t('Running fully in this browser; data is saved on this device.') : t('Connected to the ElderLink server.')}</p>
    </div>`, (m) => {
    m.querySelectorAll('[data-adv]').forEach((b) => b.onclick = async () => {
      const r = await api.post('/demo/advance', { minutes: Number(b.dataset.adv) });
      close();
      toast(r.events.length ? `${t('Time moved')}: ${r.events.slice(0, 3).join(' · ')}${r.events.length > 3 ? ` (+${r.events.length - 3})` : ''}` : t('Time moved forward'));
      render(true);
    });
    m.querySelectorAll('[data-as]').forEach((b) => b.onclick = async () => { const s = await api.post('/auth/demo', { userId: b.dataset.as }); close(); onSignedIn(s); });
    m.querySelector('[data-outbox]').onclick = () => { close(); outbox(); };
    m.querySelector('[data-offline]').onchange = (e) => { state.offline = e.target.checked; toast(state.offline ? t('Mobile data is now off (simulated)') : t('Mobile data is back on')); };
    m.querySelector('[data-reset]').onclick = async () => { await api.post('/demo/reset'); resetLocal(); close(); toast(t('Demo data reset')); const s = await api.post('/auth/demo', { userId: state.user?.id || 'usr_arjun' }).catch(() => null); if (s) onSignedIn(s); else render(); };
  });
}

async function outbox() {
  const rows = await api.get('/demo/outbox');
  const clock = await api.get('/demo/clock');
  modal(h`<h2>${icon('phone')} ${t('Phone messages')}</h2><p class="muted">${t('Every SMS, WhatsApp message and automated call the system has sent, newest first. In production these go through DLT-registered SMS, WhatsApp Business and IVR providers.')}</p>
    ${rows.length ? rows.map((n) => h`<div class="phone-msg"><div class="row between"><span class="ch ch-${n.channel}">${n.channel === 'voice' ? t('Voice call') : n.channel}</span><small>${ago(n.createdAt, clock.now)}</small></div><div><strong>${t('To')}: ${n.toName || ''}</strong> <small class="muted">${n.toPhone || ''}</small>${n.critical ? h` <span class="badge red">${t('critical')}</span>` : ''}${n.status === 'held' ? h` <span class="badge">${t('held: quiet hours')}</span>` : ''}</div><div><strong>${n.title}</strong>: ${n.body}</div></div>`) : h`<p>${t('No messages yet.')}</p>`}`);
}
export { outbox };

async function boot() {
  try { setLang(localStorage.getItem('elderlink.lang') || 'en'); } catch { setLang('en'); }
  await init();
  if (getToken()) {
    try { const me = await api.get('/me'); state.user = me.user; state.unread = me.unread; } catch { setToken(null); }
  }
  window.addEventListener('hashchange', () => render());
  render();
  if ('serviceWorker' in navigator && getMode() === 'remote') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
