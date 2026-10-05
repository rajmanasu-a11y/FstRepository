// Hospital / nursing home / agency console: requests to accept, staff assignment, roster,
// quality and reviews with one public reply each (FR-BKG-03/04, FR-VER-06, FR-REV-09, FR-QLT).
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, formData, fmtTime, fmtDate, fmtDay, money, stars, statusBadge, bandBadge, empty, initials } from '../ui.js';

const CATS = [['RN', 'Registered Nurse'], ['GNM', 'GNM nurse'], ['ANM', 'ANM nurse'], ['GDA', 'Attendant (GDA)'], ['PHYSIO', 'Physiotherapist'], ['DOCTOR', 'Doctor'], ['COMPANION', 'Companion']];
const SVC_CATS = { svc_nurse_visit: ['RN', 'GNM', 'ANM'], svc_iv: ['RN', 'GNM'], svc_catheter: ['RN', 'GNM'], svc_attendant12: ['GDA', 'ANM', 'GNM', 'RN'], svc_attendant24: ['GDA', 'ANM', 'GNM', 'RN'], svc_physio: ['PHYSIO'], svc_doctor: ['DOCTOR'], svc_palliative: ['RN', 'GNM'], svc_postop: ['RN', 'GNM'], svc_check: ['RN', 'GNM', 'ANM'], svc_companion: ['COMPANION', 'GDA'] };

function row(b, ctx, actions) {
  return h`<div class="queue-row"><div><a href="#/booking/${b.id}"><strong>${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)}</strong> · ${tf(b, 'serviceName')}</a><br><span class="muted">${b.seniorName} · ${b.seniorArea || ''}${b.caregiverName ? ' · ' + b.caregiverName : ''}</span> ${statusBadge(b.status)}</div>${actions || ''}</div>`;
}
function assignSelect(b, staff) {
  const ok = staff.filter((s) => s.status === 'verified' && (!SVC_CATS[b.serviceId] || SVC_CATS[b.serviceId].includes(s.category)));
  return h`<div class="row"><select data-assign-sel="${b.id}" aria-label="${t('Choose staff')}">${ok.map((s) => h`<option value="${s.id}">${s.name} (${s.category}, ${s.quality ?? t('new')}) · ${s.today} ${t('today')}</option>`)}</select><button class="btn small" data-assign="${b.id}">${t('Assign')}</button></div>`;
}
function bindActions(el, ctx) {
  el.querySelectorAll('[data-accept]').forEach((b) => b.onclick = async () => { try { await api.post(`/bookings/${b.dataset.accept}/accept`, {}); toast(t('Accepted. Now assign a caregiver.')); ctx.refresh(); } catch (e) { toast(e.message, true); } });
  el.querySelectorAll('[data-decline]').forEach((b) => b.onclick = async () => { if (!(await confirmBox(t('Decline? The family gets a full refund and sees other providers.'), { ok: t('Decline'), danger: true }))) return; await api.post(`/bookings/${b.dataset.decline}/decline`, { reason: 'No staff free' }); ctx.refresh(); });
  el.querySelectorAll('[data-assign]').forEach((b) => b.onclick = async () => { const id = el.querySelector(`[data-assign-sel="${b.dataset.assign}"]`).value; try { await api.post(`/bookings/${b.dataset.assign}/assign`, { caregiverId: id }); toast(t('Assigned. The family sees the caregiver profile now.')); ctx.refresh(); } catch (e) { toast(e.message, true); } });
}

export async function home(ctx) {
  const d = await api.get('/provider/home');
  const p = d.provider;
  const q = d.quality || {};
  const html = h`<div class="page-head"><h1>${p.name}</h1><p>${t(p.type === 'hospital' ? 'Hospital' : p.type === 'nursing_home' ? 'Nursing home' : 'Home-care agency')} · ${p.area || p.city} ${p.status === 'verified' ? h`<span class="badge green">${icon('check', 12)} ${t('Verified facility')}</span>` : h`<span class="badge amber">${t(p.status)}</span>`}</p></div>
    ${p.status !== 'verified' ? h`<div class="alert amber">${icon('id')}<span>${t('Your facility documents (registration under the Clinical Establishments Act, GST, insurance) are being checked. Add staff and services meanwhile; they go live once verified.')}</span></div>` : ''}
    <div class="grid four">
      <div class="stat"><div class="l">${t('New requests')}</div><div class="n">${d.requests.length}</div></div>
      <div class="stat"><div class="l">${t('To assign')}</div><div class="n">${d.toAssign.length}</div></div>
      <div class="stat"><div class="l">${t('Upcoming visits')}</div><div class="n">${d.upcoming.length}</div></div>
      <div class="stat"><div class="l">${t('Quality score')}</div><div class="n">${q.score ?? '-'}</div>${bandBadge(q.band, q.score)}</div>
    </div>
    <div class="card" style="${d.requests.length ? 'border-color:var(--accent)' : ''}"><h2>${t('New requests')} <small class="muted">(${t('accept within 2 hours or it moves to another provider')})</small></h2>
      ${d.requests.length ? d.requests.map((b) => row(b, ctx, h`<div class="btn-row"><button class="btn small" data-accept="${b.id}">${t('Accept')}</button><button class="btn small ghost" data-decline="${b.id}">${t('Decline')}</button></div>`)) : h`<p class="muted">${t('No new requests.')}</p>`}</div>
    <div class="card"><h2>${t('Accepted: assign a caregiver')}</h2>${d.toAssign.length ? d.toAssign.map((b) => row(b, ctx, assignSelect(b, d.staff))) : h`<p class="muted">${t('Everything is assigned.')}</p>`}</div>
    <div class="grid two">
      <div class="card"><h2>${t('Upcoming')}</h2>${d.upcoming.length ? d.upcoming.slice(0, 8).map((b) => row(b, ctx)) : h`<p class="muted">${t('Nothing scheduled.')}</p>`}</div>
      <div class="card"><h2>${t('Recently completed')}</h2>${d.recent.length ? d.recent.slice(0, 8).map((b) => row(b, ctx, b.rating ? h`<span class="stars">${stars(b.rating)}</span>` : '')) : h`<p class="muted">${t('No visits yet.')}</p>`}</div>
    </div>`;
  return { title: 'Dashboard', html, mount(el) { bindActions(el, ctx); } };
}

export async function bookings(ctx) {
  const [rows, d] = await Promise.all([api.get('/bookings'), api.get('/provider/home')]);
  const f = ctx.query.f || 'open';
  const open = ['requested', 'accepted', 'assigned', 'in_progress', 'completed'];
  const shown = rows.filter((b) => (f === 'open' ? open.includes(b.status) : !open.includes(b.status))).sort((a, b) => (f === 'open' ? a.start - b.start : b.start - a.start));
  const html = h`<div class="page-head"><h1>${t('Bookings')}</h1></div>
    <div class="seg">${[['open', 'Open'], ['past', 'Past']].map(([k, l]) => h`<a class="${k === f ? 'on' : ''}" href="#/prv/bookings?f=${k}">${t(l)}</a>`)}</div>
    <div class="card">${shown.length ? shown.slice(0, 60).map((b) => row(b, ctx,
      b.status === 'requested' ? h`<div class="btn-row"><button class="btn small" data-accept="${b.id}">${t('Accept')}</button><button class="btn small ghost" data-decline="${b.id}">${t('Decline')}</button></div>`
        : ['accepted', 'assigned'].includes(b.status) ? assignSelect(b, d.staff) : h`<span>${money(b.price?.providerShare)}</span>`)) : h`<p class="muted">${t('No bookings.')}</p>`}</div>`;
  return { title: 'Bookings', html, mount(el) { bindActions(el, ctx); } };
}

export async function staff(ctx) {
  const d = await api.get('/provider/home');
  const vs = { verified: ['Verified', 'green'], submitted: ['Checks in progress', 'info'], under_review: ['Checks in progress', 'info'], suspended: ['Suspended', 'red'], expired: ['Registration expired', 'red'], rejected: ['Rejected', 'red'], draft: ['Draft', ''] };
  const html = h`<div class="page-head row between"><div><h1>${t('Staff roster')}</h1><p>${t('Every staff member is verified individually before families can be assigned to them.')}</p></div><button class="btn" data-add>${icon('plus', 20)} ${t('Add staff')}</button></div>
    <div class="card">${d.staff.length ? d.staff.map((s) => { const [l, c] = vs[s.status] || [s.status, '']; return h`<div class="queue-row"><div class="row"><span class="avatar">${initials(s.name)}</span><div><strong>${s.name}</strong> <span class="badge ${c}">${t(l)}</span><br><small class="muted">${t(s.categoryLabel)} · ${t('quality')} ${s.quality ?? t('new')} · ${s.today} ${t('visits today')}</small><br>${s.badges.map((b) => h`<span class="badge green">${t(b)}</span> `)}</div></div></div>`; }) : empty(t('No staff yet.'))}</div>`;
  return {
    title: 'Staff', html,
    mount(el) {
      el.querySelector('[data-add]').onclick = () => modal(h`<h2>${t('Add staff')}</h2><form id="f">
        <label>${t('Name')}</label><input name="name" required><label>${t('Role')}</label><select name="category">${CATS.map(([v, l]) => h`<option value="${v}">${t(l)}</option>`)}</select>
        <label>${t('Nursing council registration number')}</label><input name="registrationNo"><label>${t('Gender')}</label><select name="gender"><option value="F">${t('Female')}</option><option value="M">${t('Male')}</option></select>
        <p class="hint">${t('We run Aadhaar e-KYC, registration, police and reference checks. They can be assigned once verified.')}</p>
        <button class="btn block">${t('Add and start checks')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); try { await api.post('/provider/staff', formData(e.target)); close(); toast(t('Added. Verification has started.')); ctx.refresh(); } catch (err) { toast(err.message, true); } };
      });
    },
  };
}

export async function reviews(ctx) {
  const d = await api.get('/provider/home');
  const score = (r) => Object.values(r.ratings).reduce((a, b) => a + b, 0) / Object.values(r.ratings).length;
  const html = h`<div class="page-head"><h1>${t('Reviews')}</h1><p>${t('You can reply once, publicly, to each review. Be kind and specific.')}</p></div>
    ${d.reviews.length ? d.reviews.map((r) => h`<div class="card"><div class="row between"><span><span class="stars">${stars(score(r))}</span> <strong>${r.reviewerLabel}</strong></span><small class="muted">${r.serviceName} · ${fmtDate(r.visitDate)}</small></div><p>${r.text}</p>${(r.tags || []).map((x) => h`<span class="chip">${t(x)}</span> `)}
      ${r.reply ? h`<div class="alert">${icon('chat')}<span><strong>${t('Your reply')}:</strong> ${r.reply.text}</span></div>` : h`<form data-reply="${r.id}" class="row" style="gap:8px;margin-top:8px"><input name="text" placeholder="${t('Write a reply')}" style="flex:1"><button class="btn small soft">${t('Reply')}</button></form>`}</div>`) : empty(t('No reviews yet.'))}`;
  return {
    title: 'Reviews', html,
    mount(el) { el.querySelectorAll('[data-reply]').forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); try { await api.post(`/reviews/${f.dataset.reply}/reply`, formData(f)); toast(t('Reply posted')); ctx.refresh(); } catch (err) { toast(err.message, true); } }); },
  };
}

