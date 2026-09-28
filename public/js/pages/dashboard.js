import { html, render, $, on, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, canAny, session, org } from '../lib/state.js';
import { navigate } from '../lib/router.js';
import { fmtTime, fmtLongDate, fmtDurationWords, statusBadge, todayIso, fmtNumber, fmtDate } from '../lib/format.js';
import { dataTable } from '../lib/table.js';
import { loadingBlock, emptyState, toastError } from '../lib/ui.js';
import { columnChart, barList, splitBar, bindTooltips } from '../lib/charts.js';

const toBar = (d) => ({ label: d.label, value: d.count });
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom Range']];

export default async function dashboard(root, { query }) {
  const state = {
    period: query.get('period') || 'today',
    from: query.get('from') || todayIso(-7),
    to: query.get('to') || todayIso(),
  };
  const isHost = session.user.roleCode === 'HOST';

  const quick = [
    { href: '/register', label: 'New Visitor', icon: 'userPlus', perm: ['visit.create'], primary: true },
    { href: '/visitors', label: 'Search Visitor', icon: 'search', perm: ['visitor.view'] },
    { href: '/check-in', label: 'Check-In', icon: 'logIn', perm: ['visit.checkin'] },
    { href: '/check-out', label: 'Check-Out', icon: 'logOut', perm: ['visit.checkout'] },
    { href: `/visitors?from=${todayIso()}&to=${todayIso()}`, label: "Today's Visitors", icon: 'calendar', perm: ['visit.view_all'] },
    { href: '/on-premises', label: 'Currently On Premises', icon: 'mapPin', perm: ['onpremises.view'] },
    { href: '/reports', label: 'Reports', icon: 'chart', perm: ['report.view'] },
    { href: '/pre-registration', label: 'Pre-Register Visitor', icon: 'calendarCheck', perm: ['prereg.own'], hostOnly: true },
    { href: '/approvals', label: 'Pending Approvals', icon: 'userCheck', perm: ['visit.approve_own'], hostOnly: true },
    { href: '/visitors', label: 'My Visitor History', icon: 'history', perm: ['visit.view_own'], hostOnly: true },
  ].filter((q) => canAny(...q.perm) && (!q.hostOnly || isHost));

  render(root, html`
    <div class="page-header">
      <div>
        <h1>${isHost ? 'My Visitors' : 'Dashboard'}</h1>
        <div class="subtitle">${fmtLongDate(todayIso())} · ${org().receptionPoint || 'Reception'} · ${session.user.fullName}, ${session.user.roleName}</div>
      </div>
      <div class="page-actions">
        <div class="segmented" role="group" aria-label="Dashboard period">
          ${PERIODS.map(([k, l]) => html`<button type="button" data-period="${k}" aria-pressed="${state.period === k}">${l}</button>`)}
        </div>
        <div class="row" data-custom ${state.period === 'custom' ? '' : 'hidden'}>
          <label class="sr-only" for="dash-from">From date</label>
          <input type="date" id="dash-from" class="input" style="width:auto;height:32px" value="${state.from}" max="${todayIso()}">
          <span class="muted">to</span>
          <label class="sr-only" for="dash-to">To date</label>
          <input type="date" id="dash-to" class="input" style="width:auto;height:32px" value="${state.to}">
          <button type="button" class="btn sm primary" data-apply-range>Apply</button>
        </div>
      </div>
    </div>
    <nav class="quick-actions" aria-label="Quick actions">
      ${quick.map((q) => html`<a class="quick-action ${q.primary ? 'primary' : ''}" href="${q.href}">${icon(q.icon)}<span>${q.primary ? '+ ' : ''}${q.label}</span></a>`)}
    </nav>
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" class="sr-only">Summary</h2>
      <div class="stats" data-stats>${loadingBlock('Loading summary…')}</div>
    </section>
    <section class="card" aria-labelledby="live-title">
      <div class="card-header">
        <div><h2 id="live-title">Live Visitor Status</h2><div class="hint" data-live-hint></div></div>
        <div class="row">
          <label class="sr-only" for="live-filter">Filter by status</label>
          <select id="live-filter" class="select" style="width:auto;height:32px">
            <option value="">All statuses</option>
            <option value="OVERSTAY">Overstay</option>
            <option value="CHECKED_IN">Checked-In</option>
            <option value="EXPECTED">Expected</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="CHECKED_OUT">Checked-Out</option>
            <option value="DENIED">Denied</option>
          </select>
          <button type="button" class="btn sm" data-refresh aria-label="Refresh">${icon('refresh')}Refresh</button>
        </div>
      </div>
      <div data-live>${loadingBlock('Loading visitor status…')}</div>
    </section>
    ${can('dashboard.analytics') ? html`
      <section aria-labelledby="analytics-title" class="mt-3">
        <div class="row between"><h2 id="analytics-title">Visitor Analytics</h2><span class="muted" data-analytics-range style="font-size:.85rem"></span></div>
        <div class="charts" data-charts>${loadingBlock('Loading analytics…')}</div>
      </section>` : ''}
  `);

  let summary = null;

  let seq = 0;
  async function loadSummary() {
    const mine = ++seq;
    const params = { period: state.period };
    if (state.period === 'custom') Object.assign(params, { from: state.from, to: state.to });
    try {
      const res = await api('/dashboard/summary', { query: params });
      if (mine !== seq) return;
      summary = res;
      renderStats();
      renderLive();
    } catch (err) {
      toastError(err);
      render($('[data-stats]', root), emptyState('Unable to load the summary', 'Please refresh the page.'));
    }
  }

  function renderStats() {
    const s = summary.stats;
    const r = summary.range;
    const rangeQ = `from=${r.from}&to=${r.to}`;
    const periodLabel = PERIODS.find((p) => p[0] === state.period)?.[1] || '';
    const cards = [
      { label: `Total Visitors ${state.period === 'today' ? 'Today' : ''}`, value: s.totalVisitors, icon: 'users', tone: 'info', href: `/visitors?${rangeQ}` },
      { label: 'Currently Inside', value: s.currentlyInside, icon: 'mapPin', tone: 'success', href: '/on-premises', foot: s.overstay ? `${s.overstay} overstay` : 'Live count', alert: s.overstay > 0 },
      { label: 'Checked Out', value: s.checkedOut, icon: 'logOut', tone: 'neutral', href: `/visitors?${rangeQ}&status=CHECKED_OUT` },
      { label: 'Expected Visitors', value: s.expected, icon: 'calendarCheck', tone: 'info', href: can('visit.checkin') ? '/check-in' : `/visitors?${rangeQ}&status=EXPECTED,APPROVED` },
      { label: 'Pending Approvals', value: s.pendingApprovals, icon: 'hourglass', tone: 'warning', href: canAny('visit.approve_own', 'visit.approve_any') ? '/approvals' : `/visitors?status=PENDING_APPROVAL`, foot: 'Awaiting host decision' },
      { label: 'Repeat Visitors', value: s.repeatVisitors, icon: 'repeat', tone: 'info', href: `/visitors?${rangeQ}&visitorType=REPEAT` },
      { label: 'First-Time Visitors', value: s.firstTimeVisitors, icon: 'sparkle', tone: 'info', href: `/visitors?${rangeQ}&visitorType=FIRST_TIME` },
      { label: 'Restricted / Flagged', value: s.restricted, icon: 'shieldAlert', tone: 'danger', href: can('report.view') ? '/reports/restricted' : `/visitors?${rangeQ}&watchlist=true`, alert: s.restricted > 0, foot: 'Alerts raised' },
    ];
    render($('[data-stats]', root), html`${cards.map((c) => html`
      <a class="stat tone-${c.tone} ${c.alert ? 'alerting' : ''}" href="${c.href}">
        <span class="stat-label">${icon(c.icon)}${c.label.trim()}</span>
        <span class="stat-value">${fmtNumber(c.value)}</span>
        <span class="stat-foot">${c.foot || periodLabel}</span>
      </a>`)}`);
    $('[data-live-hint]', root).textContent = `${r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} to ${fmtDate(r.to)}`} · visitors on premises are always shown`;
  }

  function renderLive() {
    const filter = $('#live-filter', root).value;
    const rows = summary.visits.filter((v) => !filter || v.status === filter);
    const photo = (v) => (v.visitor.photoUrl ? html`<img class="thumb" src="${v.visitor.photoUrl}" alt="" loading="lazy">` : html`<span class="thumb-initials" aria-hidden="true">${initials(v.visitor.fullName)}</span>`);
    render($('[data-live]', root), dataTable({
      caption: 'Live visitor status',
      columns: [
        { key: 'visitor', label: 'Visitor', render: (v) => html`<div class="person">${photo(v)}<div><div class="cell-main"><a href="/visits/${v.id}">${v.visitor.fullName}</a>${v.visitor.watchlistStatus !== 'NONE' ? html` <span class="tag danger" title="${v.visitor.watchlistReason || ''}">${icon('shieldAlert')}${v.visitor.watchlistStatus === 'BLOCKED' ? 'Restricted' : 'Flagged'}</span>` : ''}</div><div class="cell-sub">${v.visitCode}</div></div></div>` },
        { key: 'company', label: 'Organisation / Company', render: (v) => v.companyName || html`<span class="faint">—</span>` },
        { key: 'host', label: 'Whom to Meet', render: (v) => html`<div class="cell-main">${v.host.name}</div><div class="cell-sub">${v.host.designation}</div>` },
        { key: 'purpose', label: 'Purpose', render: (v) => v.purpose },
        { key: 'checkIn', label: 'Check-In', render: (v) => (v.checkInAt ? html`<div>${fmtTime(v.checkInAt)}</div>${['CHECKED_IN', 'OVERSTAY'].includes(v.status) ? html`<div class="cell-sub">${fmtDurationWords(v.elapsedMinutes)}</div>` : v.checkOutAt ? html`<div class="cell-sub">Out ${fmtTime(v.checkOutAt)}</div>` : ''}` : v.expectedArrival ? html`<span class="muted">Exp. ${fmtTime(v.expectedArrival)}</span>` : html`<span class="faint">—</span>`) },
        { key: 'status', label: 'Status', render: (v) => statusBadge(v.status) },
      ],
      rows,
      rowAttrs: (v) => ({ cls: `clickable ${v.status === 'OVERSTAY' ? 'row-alert' : v.status === 'DENIED' ? 'row-danger' : ''}`, href: `/visits/${v.id}` }),
      empty: emptyState('No visitors found', 'Try changing the status filter or the date range.', 'users'),
    }));
  }

  async function loadAnalytics() {
    const box = $('[data-charts]', root);
    if (!box) return;
    try {
      const a = await api('/dashboard/analytics');
      $('[data-analytics-range]', root).textContent = `Last 30 days: ${fmtDate(a.range.from)} to ${fmtDate(a.range.to)}`;
      const days = a.byDay.map((d) => ({ label: d.day.slice(8, 10), title: fmtDate(d.day), value: d.count }));
      const months = a.byMonth.map((m) => {
        const [y, mo] = m.month.split('-');
        const name = new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
        return { label: name, title: `${name} ${y}`, value: m.count };
      });
      const hours = a.peakHours.filter((h) => h.hour >= 7 && h.hour <= 20).map((h) => ({ label: `${h.hour % 12 || 12}${h.hour < 12 ? 'a' : 'p'}`, title: `${String(h.hour).padStart(2, '0')}:00–${String(h.hour + 1).padStart(2, '0')}:00`, value: h.count }));
      const peak = [...a.peakHours].sort((x, y) => y.count - x.count)[0];
      const rv = a.repeatVsFirst || { repeat: 0, first_time: 0 };
      const card = (title, sub, body) => html`<div class="card chart-card"><div class="card-body"><h3>${title}</h3><div class="chart-sub mb-1">${sub}</div>${body}</div></div>`;
      render(box, html`
        ${card('Visitors by day', 'Checked-in visits per day, last 30 days', columnChart(days, { caption: 'Visitors by day', labelEvery: 5 }))}
        ${card('Visitors by month', 'Checked-in visits per month, last 12 months', columnChart(months, { caption: 'Visitors by month' }))}
        ${card('Peak visiting hours', peak?.count ? `Busiest hour: ${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour + 1).padStart(2, '0')}:00` : 'Check-ins by hour of day', columnChart(hours, { caption: 'Check-ins by hour', labelEvery: 2 }))}
        ${card('Visitors by department', 'Top departments, last 30 days', a.byDepartment.length ? barList(a.byDepartment.map(toBar), { caption: 'Visitors by department' }) : emptyState('No visits in this period'))}
        ${card('Visitors by purpose', 'Top purposes of visit, last 30 days', a.byPurpose.length ? barList(a.byPurpose.map(toBar), { caption: 'Visitors by purpose' }) : emptyState('No visits in this period'))}
        ${card('Visitors by organisation', 'Top organisations, last 30 days', a.byCompany.length ? barList(a.byCompany.slice(0, 8).map(toBar), { caption: 'Visitors by organisation' }) : emptyState('No visits in this period'))}
        ${card('Repeat vs first-time visitors', 'Share of checked-in visits, last 30 days', html`
          ${splitBar({ label: 'Repeat', value: rv.repeat }, { label: 'First-time', value: rv.first_time }, { caption: 'Repeat versus first-time visitors' })}
          <hr>
          <div class="kpi-inline">
            <div><div class="muted" style="font-size:.82rem">Average visit duration</div><b>${a.averageDuration.avg_minutes != null ? fmtDurationWords(a.averageDuration.avg_minutes) : '—'}</b></div>
            <div><div class="muted" style="font-size:.82rem">Completed visits</div><b>${fmtNumber(a.averageDuration.completed)}</b></div>
          </div>`)}
      `);
      bindTooltips(box);
    } catch (err) {
      render(box, emptyState('Analytics are unavailable', err.message, 'chart'));
    }
  }

  on(root, 'click', '[data-period]', (e, btn) => {
    state.period = btn.dataset.period;
    root.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    $('[data-custom]', root).hidden = state.period !== 'custom';
    if (state.period === 'custom') { $('#dash-from', root).focus(); return; }
    loadSummary();
  });
  on(root, 'click', '[data-apply-range]', () => {
    state.from = $('#dash-from', root).value;
    state.to = $('#dash-to', root).value;
    if (!state.from || !state.to) return;
    loadSummary();
  });
  on(root, 'change', '#live-filter', () => summary && renderLive());
  on(root, 'click', '[data-refresh]', () => loadSummary());
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a,button')) navigate(tr.dataset.href); });

  await loadSummary();
  loadAnalytics();
  const timer = setInterval(loadSummary, 60_000);
  return () => clearInterval(timer);
}
