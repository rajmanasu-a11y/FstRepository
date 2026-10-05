// Caregiver app (nurse, attendant, physio, helper): today's visits, requests, geo check-in with visit code,
// checklist and vitals at checkout (FR-BKG-03..08), listings and prices (FR-LST), payouts (FR-PAY-04),
// academy (FR-VER-08, FR-PGT-01) and verification profile (FR-VER-01..03).
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, formData, fmtTime, fmtDate, fmtDateTime, fmtDay, money, stars, statusBadge, bandBadge, empty, ago, initials } from '../ui.js';

const back = (href, label = 'Back') => h`<a class="back" href="${href}">${icon('back')} ${t(label)}</a>`;
const VSTATUS = { draft: ['Not submitted', ''], submitted: ['Submitted', 'info'], under_review: ['Being checked', 'info'], verified: ['Verified', 'green'], rejected: ['Needs changes', 'red'], suspended: ['Suspended', 'red'], expired: ['Registration expired', 'red'] };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function visitRow(b, ctx, { request = false } = {}) {
  return h`<div class="queue-row">
    <div><strong>${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)}</strong> · ${tf(b, 'serviceName')}<br><span class="muted">${b.seniorName} · ${b.area || b.seniorArea || ''}${b.isCheckVisit ? ' · ' + t('check visit') : ''}</span> ${statusBadge(b.status)}</div>
    ${request ? h`<div class="btn-row"><button class="btn small" data-accept="${b.id}">${t('Accept')}</button><button class="btn small ghost" data-decline="${b.id}">${t('Decline')}</button><small class="muted">${money(b.price?.providerShare)} ${t('to you')}</small></div>`
      : h`<a class="btn small ${b.status === 'assigned' || b.status === 'in_progress' ? '' : 'soft'}" href="#/cg/visit/${b.id}">${b.status === 'in_progress' ? t('Continue visit') : b.status === 'assigned' ? t('Start visit') : t('Open')}</a>`}
  </div>`;
}

export async function home(ctx) {
  const d = await api.get('/caregiver/home');
  if (!d.caregiver) return { title: 'Today', html: empty(t('No caregiver profile on this account.')) };
  const cg = d.caregiver;
  const [vl, vc] = VSTATUS[cg.status] || [cg.status, ''];
  const q = d.quality;
  const html = h`<div class="page-head"><h1>${t('Hello')}, ${cg.name.split(' ')[0]}</h1><p>${t(cg.categoryLabel)} · ${d.provider.type === 'independent' ? t('Independent') : d.provider.name} · <span class="badge ${vc}">${t(vl)}</span></p></div>
    ${cg.status !== 'verified' ? h`<div class="alert ${cg.status === 'rejected' || cg.status === 'suspended' ? 'red' : 'amber'}">${icon('id')}<span>${cg.status === 'draft' ? t('Finish your profile and documents to start getting bookings.') : cg.status === 'submitted' || cg.status === 'under_review' ? t('We are checking your documents. This usually takes 3 to 5 working days.') : cg.statusReason || t('Please contact your coordinator.')}</span><a class="btn small" href="#/cg/profile">${t('Open profile')}</a></div>` : ''}
    <div class="grid four">
      <div class="stat"><div class="l">${t('Visits today')}</div><div class="n">${d.today.length}</div></div>
      <div class="stat"><div class="l">${t('Earned, 30 days')}</div><div class="n">${money(d.earnings.month)}</div></div>
      <div class="stat"><div class="l">${t('Payout coming')}</div><div class="n">${money(d.earnings.scheduled)}</div></div>
      <div class="stat"><div class="l">${t('Quality score')}</div><div class="n">${q.score ?? '-'}</div>${bandBadge(q.band, q.score)}</div>
    </div>
    ${d.requests.length ? h`<div class="card" style="border-color:var(--accent)"><h2>${icon('bell')} ${t('New requests')} <small class="muted">(${t('reply within 2 hours')})</small></h2>${d.requests.map((b) => visitRow(b, ctx, { request: true }))}</div>` : ''}
    <div class="card"><h2>${t('Today')}</h2>${d.today.length ? d.today.map((b) => visitRow(b, ctx)) : h`<p class="muted">${t('No visits today.')}</p>`}</div>
    <div class="card"><h2>${t('Coming up')}</h2>${d.upcoming.length ? d.upcoming.map((b) => visitRow(b, ctx)) : h`<p class="muted">${t('Nothing booked yet.')}</p>`}</div>
    <div class="grid two">
      <div class="card"><h2>${t('How families rate you')}</h2>
        <dl class="kv"><dt>${t('Average rating')}</dt><dd>${q.parts.avgRating ? h`<span class="stars">${stars(q.parts.avgRating)}</span> ${q.parts.avgRating.toFixed(1)}` : '-'}</dd>
          <dt>${t('On time')}</dt><dd>${q.parts.onTimeRate != null ? Math.round(q.parts.onTimeRate * 100) + '%' : '-'}</dd>
          <dt>${t('Checklist done')}</dt><dd>${q.parts.checklistRate != null ? Math.round(q.parts.checklistRate * 100) + '%' : '-'}</dd>
          <dt>${t('Families who rebook')}</dt><dd>${Math.round((q.parts.repeatRate || 0) * 100)}%</dd><dt>${t('Visits, 90 days')}</dt><dd>${q.parts.visits}</dd></dl>
        <div>${(cg.badges || []).map((x) => h`<span class="badge green">${icon('check', 12)} ${t(x)}</span> `)}</div></div>
      <div class="card"><h2>${t('Latest reviews')}</h2>${d.reviews.length ? d.reviews.map((rv) => h`<div style="margin-bottom:.6rem"><span class="stars">${stars(Object.values(rv.ratings).reduce((a, b) => a + b, 0) / Object.values(rv.ratings).length)}</span> <small class="muted">${rv.reviewerLabel} · ${ago(rv.createdAt, ctx.now)}</small><br>${rv.text}</div>`) : h`<p class="muted">${t('No reviews yet.')}</p>`}</div>
    </div>
    <button class="btn danger ghost" data-panic>${icon('alert', 20)} ${t('I feel unsafe')}</button>`;
  return {
    title: 'Today', html,
    mount(el) {
      el.querySelectorAll('[data-accept]').forEach((b) => b.onclick = async () => { try { await api.post(`/bookings/${b.dataset.accept}/accept`, {}); toast(t('Accepted. The family has been told.')); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      el.querySelectorAll('[data-decline]').forEach((b) => b.onclick = async () => { if (!(await confirmBox(t('Decline this request? The family gets a full refund.'), { ok: t('Decline'), danger: true }))) return; await api.post(`/bookings/${b.dataset.decline}/decline`, { reason: 'Not available' }); ctx.refresh(); });
      el.querySelector('[data-panic]').onclick = () => panic(null);
    },
  };
}

async function panic(bookingId) {
  if (!(await confirmBox(t('Alert the ElderLink emergency desk that you feel unsafe? They will call you right away.'), { ok: t('Yes, alert the desk'), danger: true }))) return;
  const r = await api.post('/caregiver/panic', { bookingId });
  toast(t(r.message));
}

// ---------- the visit itself ----------
export async function visit(ctx) {
  const b = await api.get(`/bookings/${ctx.params.id}`);
  const cp = b.careProfile;
  const items = b.checklistItems || [];
  const isCheck = b.isCheckVisit;
  const step = b.status === 'in_progress' ? 'during' : b.status === 'assigned' ? 'before' : 'after';
  const html = h`${back('#/cg')}
    <div class="page-head"><h1>${tf(b, 'serviceName')}</h1><p>${b.seniorName} · ${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)}–${fmtTime(b.end)} · ${statusBadge(b.status)}</p></div>
    ${cp ? h`<div class="card"><h2>${t('About')} ${cp.name.split(' ')[0]}</h2>
      <dl class="kv"><dt>${t('Address')}</dt><dd>${cp.address}</dd><dt>${t('Age')}</dt><dd>${cp.age}</dd><dt>${t('Conditions')}</dt><dd>${(cp.conditions || []).join(', ')}</dd>
        <dt>${t('Allergies')}</dt><dd><strong>${(cp.allergies || []).join(', ') || t('None known')}</strong></dd><dt>${t('Mobility')}</dt><dd>${cp.mobility}</dd><dt>${t('Memory')}</dt><dd>${cp.cognition}</dd>
        <dt>${t('Emergency contact')}</dt><dd>${cp.emergencyContacts?.[0] ? `${cp.emergencyContacts[0].name}` : '-'}</dd></dl>
      ${cp.carePlan?.doNot?.length ? h`<div class="alert red">${icon('alert')}<span><strong>${t('Please do not')}:</strong> ${cp.carePlan.doNot.join(' · ')}</span></div>` : ''}
      ${cp.carePlan?.preferences ? h`<p class="muted">${Object.values(cp.carePlan.preferences).filter(Boolean).join(' · ')}</p>` : ''}
    </div>` : h`<div class="alert">${icon('lock')}<span>${t(b.careProfileNote || 'Care profile not available')}</span></div>`}
    ${step === 'before' ? h`<div class="card"><h2>1. ${t('Check in at the door')}</h2>
      <p class="muted">${t('Your phone location must be within 150 m of the home, and the senior or family gives you the 4-digit visit code.')}</p>
      <form id="ci"><label for="code">${t('Visit code')}</label><input id="code" name="code" inputmode="numeric" maxlength="4" class="big-input" required>
        <div class="btn-row" style="margin-top:12px"><button class="btn" data-where="home">${icon('pin', 20)} ${t("I'm at the home: check in")}</button><button type="button" class="btn ghost small" data-where="far">${t('Demo: try from 400 m away')}</button></div></form>
      <p class="hint">${t('Demo: the visit code is shown on the senior and family screens.')}</p></div>` : ''}
    ${step === 'during' ? h`<form id="co">
      <div class="card checklist"><h2>2. ${t('Checklist')}</h2>${items.map((i) => h`<label class="check"><input type="checkbox" name="ck" value="${i}" data-multi="1"> ${t(i)}</label>`)}</div>
      <div class="card"><h2>3. ${t('Vitals')}</h2><div class="grid three">
        ${[['bpSys', 'BP upper', '120'], ['bpDia', 'BP lower', '80'], ['pulse', 'Pulse', '76'], ['spo2', 'SpO2 %', '97'], ['temp', 'Temp °F', '98.4'], ['sugar', 'Sugar mg/dL', '130'], ['weight', 'Weight kg', '']].map(([k, l, ph]) => h`<div><label for="v_${k}">${t(l)}</label><input id="v_${k}" name="v_${k}" inputmode="decimal" placeholder="${ph}"></div>`)}
      </div></div>
      ${cp?.medicines?.length ? h`<div class="card"><h2>4. ${t('Medicines given now')}</h2>${cp.medicines.map((m) => h`<label class="check"><input type="checkbox" name="meds" value="${m.id}" data-multi="1"> ${m.name} ${m.strength} <small class="muted">(${m.times.join(', ')})</small></label>`)}</div>` : ''}
      <div class="card"><h2>${t('Notes for the family')}</h2>
        <label>${t('Mood')}</label><div class="seg" role="radiogroup">${['good', 'okay', 'low', 'very low'].map((m, i) => h`<label><input type="radio" name="mood" value="${m}" ${i === 0 ? 'checked' : ''}><span>${t(m)}</span></label>`)}</div>
        ${isCheck ? h`<label>${t('Fall risk at home')}</label><div class="seg">${['none', 'some', 'high'].map((m, i) => h`<label><input type="radio" name="fallRisk" value="${m}" ${i === 0 ? 'checked' : ''}><span>${t(m)}</span></label>`)}</div>
          <label>${t('Medicine stock')}</label><div class="seg">${['ok', 'low'].map((m, i) => h`<label><input type="radio" name="medStock" value="${m}" ${i === 0 ? 'checked' : ''}><span>${t(m === 'ok' ? 'Enough' : 'Running low')}</span></label>`)}</div>` : ''}
        <label for="obs">${t('What you noticed')}</label><textarea id="obs" name="observations" rows="3"></textarea>
        <button class="btn block" style="margin-top:12px">${icon('check', 20)} ${t('Check out and send report')}</button></div>
    </form>` : ''}
    ${step === 'after' ? h`<div class="card"><h2>${t('Visit finished')}</h2><p>${b.checkOutAt ? `${t('Checked out at')} ${fmtTime(b.checkOutAt)}. ${t('The family has the report.')}` : ''}</p>
      ${b.payout ? h`<p>${t('Payout')}: <strong>${money(b.payout.amount)}</strong> <span class="badge">${t(b.payout.status)}</span> ${b.payout.dueAt ? `· ${fmtDate(b.payout.dueAt)}` : ''}</p>` : h`<p class="muted">${t('Payout is scheduled 2 days after the family confirms (or automatically after 24 hours).')}</p>`}
      ${b.checkOutAt ? h`<button class="btn soft small" data-household>${t('Rate this home (private)')}</button>` : ''}</div>` : ''}
    <div class="btn-row"><button class="btn ghost small" data-call>${icon('phone', 18)} ${t('Call family (masked)')}</button>${['assigned', 'in_progress'].includes(b.status) ? h`<button class="btn danger ghost small" data-sos>${icon('siren', 18)} ${t('Senior emergency: SOS')}</button>` : ''}<button class="btn danger ghost small" data-panic>${icon('alert', 18)} ${t('I feel unsafe')}</button></div>`;
  return {
    title: 'Visit', html,
    mount(el) {
      const ci = el.querySelector('#ci');
      if (ci) {
        const go = async (far) => {
          const code = el.querySelector('#code').value;
          const lat = (cp?.lat ?? 12.97) + (far ? 0.0037 : 0.0004), lng = cp?.lng ?? 77.59;
          try { await api.post(`/bookings/${b.id}/checkin`, { lat, lng, code }); toast(t('Checked in. The family has been told you arrived.')); ctx.refresh(); } catch (e) { toast(e.message, true); }
        };
        ci.onsubmit = (e) => { e.preventDefault(); go(false); };
        el.querySelector('[data-where=far]').onclick = () => go(true);
      }
      const co = el.querySelector('#co');
      if (co) co.onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(co);
        const checklist = Object.fromEntries((f.ck || []).map((x) => [x, true]));
        const vitals = {};
        for (const k of ['bpSys', 'bpDia', 'pulse', 'spo2', 'temp', 'sugar', 'weight']) if (f['v_' + k]) vitals[k] = Number(f['v_' + k]);
        try {
          await api.post(`/bookings/${b.id}/checkout`, { checklist, vitals, medsGiven: f.meds || [], observations: f.observations, mood: f.mood, fallRisk: f.fallRisk, medStock: f.medStock, lat: cp?.lat, lng: cp?.lng });
          toast(t('Report sent. Thank you!')); ctx.refresh();
        } catch (err) { toast(err.message, true); }
      };
      el.querySelector('[data-call]').onclick = async () => { const r = await api.post(`/bookings/${b.id}/call`, { to: 'senior' }); toast(r.message); };
      el.querySelector('[data-panic]').onclick = () => panic(b.id);
      el.querySelector('[data-sos]')?.addEventListener('click', async () => {
        if (!(await confirmBox(t('Raise an SOS for the senior? The desk and family are alerted at once.'), { ok: t('Raise SOS'), danger: true }))) return;
        try { await api.post('/sos', { seniorId: b.seniorId, lat: cp?.lat, lng: cp?.lng }); toast(t('SOS raised. Stay with the senior; the desk will call you.')); } catch (e) { toast(e.message, true); }
      });
      el.querySelector('[data-household]')?.addEventListener('click', () => modal(h`<h2>${t('Rate this home')}</h2><p class="muted">${t('Only ElderLink sees this. It helps keep caregivers safe.')}</p><form id="f">
        <label>${t('How was the home?')}</label><div class="seg">${[1, 2, 3, 4, 5].map((n) => h`<label><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}><span>${n}★</span></label>`)}</div>
        <label>${t('Any safety concern?')}</label><select name="flag"><option value="">${t('No')}</option><option>${t('Abusive behaviour')}</option><option>${t('Unsafe home')}</option><option>${t('Asked for unpaid extra work')}</option></select>
        <label>${t('Notes')}</label><textarea name="text" rows="2"></textarea><button class="btn block" style="margin-top:12px">${t('Send')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); await api.post(`/bookings/${b.id}/household`, formData(e.target)); close(); toast(t('Thank you. Sent privately.')); };
      }));
    },
  };
}

// ---------- listings and availability (also used by organisation admins) ----------
export async function listings(ctx) {
  const [mine, cat] = await Promise.all([api.get('/my/listings'), api.get('/catalogue/allowed')]);
  const pv = ctx.user.role === 'provider_admin' ? (await api.get('/provider/home')).provider : null;
  const av = pv?.availability;
  const st = { published: ['Live', 'green'], paused: ['Paused', 'amber'], draft: ['Draft: goes live after verification', ''], review: ['Price under review', 'amber'], hidden: ['Hidden', 'red'], unpublished: ['Off', ''] };
  const html = h`<div class="page-head row between"><div><h1>${t('My services and prices')}</h1><p>${t('Set your minimum charge. Families see it before booking. You can only list services your qualification allows.')}</p></div><button class="btn" data-new>${icon('plus', 20)} ${t('Add a service')}</button></div>
    ${mine.length ? h`<div class="grid two">${mine.map((l) => { const [sl, sc] = st[l.status] || [l.status, '']; return h`<div class="card">
      <div class="row between top"><h3 style="margin:0">${tf(l, 'serviceName')}</h3><span class="badge ${sc}">${t(sl)}</span></div>
      <div class="price" style="margin:.4rem 0">${money(l.minCharge)} <small class="muted">/ ${t(l.unit)}</small></div>
      <small class="muted">${t('City median')}: ${money(l.medianPrice)} · ${t('Covers')} ${l.radiusKm} km</small>
      ${l.flag ? h`<div class="alert amber">${icon('alert')}<span>${l.flag === 'low' ? t('Much lower than the city median. Our team checks this to protect quality.') : t('Much higher than the city median. Our team will review it.')}</span></div>` : ''}
      ${l.addOns?.length ? h`<p class="muted">${t('Add-ons')}: ${l.addOns.map((a) => `${a.name} ${money(a.price)}`).join(', ')}</p>` : ''}
      <div class="btn-row"><button class="btn small soft" data-price="${l.id}" data-cur="${l.minCharge}">${t('Change price')}</button>
        ${l.status === 'published' ? h`<button class="btn small ghost" data-status="${l.id}" data-to="paused">${t('Pause')}</button>` : l.status === 'paused' ? h`<button class="btn small ghost" data-status="${l.id}" data-to="published">${t('Go live')}</button>` : ''}</div>
      ${l.history?.length > 1 ? h`<details><summary class="muted">${t('Price history')}</summary>${l.history.map((x) => h`<div><small>${fmtDate(x.createdAt)}: ${money(x.minCharge)}</small></div>`)}</details>` : ''}
    </div>`; })}</div>` : empty(t('No services yet. Add your first one.'))}
    <div class="card"><h2>${t('When can you work?')}</h2><form id="av">
      <div class="chips">${WD.map((d, i) => h`<label class="chip"><input type="checkbox" name="days" value="${i}" data-multi="1" ${(av?.days || [1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''}> ${t(d)}</label>`)}</div>
      <div class="row" style="gap:12px;margin-top:10px"><label>${t('From')} <input type="time" name="from" value="${av?.from || '08:00'}"></label><label>${t('To')} <input type="time" name="to" value="${av?.to || '18:00'}"></label><button class="btn small soft">${t('Save')}</button></div></form></div>`;
  return {
    title: 'My services', html,
    mount(el) {
      el.querySelector('[data-new]').onclick = () => {
        const allowed = cat.filter((s) => s.allowedForMe);
        const blocked = cat.filter((s) => !s.allowedForMe);
        modal(h`<h2>${t('Add a service')}</h2><form id="f">
          <label>${t('Service')}</label><select name="serviceId" required>${allowed.map((s) => h`<option value="${s.id}" data-m="${s.medianPrice}">${tf(s, 'name')} (${t('median')} ${money(s.medianPrice)})</option>`)}</select>
          ${blocked.length ? h`<p class="hint">${t('Not allowed for your qualification')}: ${blocked.slice(0, 6).map((s) => tf(s, 'name')).join(', ')}${blocked.length > 6 ? '…' : ''}</p>` : ''}
          <label>${t('Minimum charge (₹)')}</label><input name="minCharge" inputmode="numeric" required>
          <label>${t('How far will you travel? (km)')}</label><input name="radiusKm" inputmode="numeric" value="6">
          <label>${t('Add-on (optional)')}</label><div class="grid two"><input name="aoName" placeholder="${t('e.g. Dressing kit')}"><input name="aoPrice" inputmode="numeric" placeholder="₹"></div>
          <button class="btn block" style="margin-top:12px">${t('Save')}</button></form>`, (m, close) => {
          m.querySelector('#f').onsubmit = async (e) => {
            e.preventDefault();
            const f = formData(e.target);
            try {
              const r = await api.post('/my/listings', { serviceId: f.serviceId, minCharge: Number(f.minCharge), radiusKm: Number(f.radiusKm), addOns: f.aoName ? [{ name: f.aoName, price: Number(f.aoPrice) }] : [] });
              close(); toast(r.flag ? t('Saved. The price is outside the usual range, so our team will review it first.') : r.status === 'published' ? t('Your service is live.') : t('Saved. It goes live once you are verified.')); ctx.refresh();
            } catch (err) { toast(err.message, true); }
          };
        });
      };
      el.querySelectorAll('[data-price]').forEach((b) => b.onclick = () => modal(h`<h2>${t('Change price')}</h2><form id="f"><label>${t('Minimum charge (₹)')}</label><input name="minCharge" inputmode="numeric" value="${b.dataset.cur}"><p class="hint">${t('New price applies to new bookings only.')}</p><button class="btn block">${t('Save')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api.patch(`/my/listings/${b.dataset.price}`, { minCharge: Number(formData(e.target).minCharge) }); close(); toast(r.notice || t('Saved')); ctx.refresh(); } catch (err) { toast(err.message, true); } };
      }));
      el.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => { try { await api.patch(`/my/listings/${b.dataset.status}`, { status: b.dataset.to }); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      el.querySelector('#av').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); try { await api.put('/my/availability', { days: f.days, from: f.from, to: f.to }); toast(t('Saved')); } catch (err) { toast(err.message, true); } };
    },
  };
}

// ---------- earnings ----------
export async function earnings(ctx) {
  const d = await api.get('/my/payouts');
  const st = { scheduled: ['Scheduled', 'info'], paid: ['Paid', 'green'], held: ['On hold: complaint open', 'red'] };
  const html = h`<div class="page-head"><h1>${t('Earnings and payouts')}</h1><p>${t('Money is paid to your bank 2 working days after the family confirms the visit. 1% TDS is deducted as per Section 194-O.')}</p></div>
    <div class="grid four">
      <div class="stat"><div class="l">${t('Waiting for visits to finish')}</div><div class="n">${money(d.inEscrow)}</div></div>
      <div class="stat"><div class="l">${t('Scheduled')}</div><div class="n">${money(d.scheduled)}</div></div>
      <div class="stat"><div class="l">${t('Paid')}</div><div class="n">${money(d.paid)}</div></div>
      <div class="stat"><div class="l">${t('On hold')}</div><div class="n">${money(d.held)}</div></div>
    </div>
    ${d.bank ? h`<p class="muted">${icon('wallet', 16)} ${d.bank.bank} ····${d.bank.last4} ${d.bank.verified ? h`<span class="badge green">${t('verified')}</span>` : ''}</p>` : h`<div class="alert amber">${t('Add your bank account in Profile to receive payouts.')}</div>`}
    <div class="card"><div class="table-wrap"><table><thead><tr><th>${t('Visit')}</th><th>${t('Amount')}</th><th>${t('Status')}</th><th>${t('Pay date')}</th></tr></thead><tbody>
      ${d.rows.map((p) => { const [l, c] = st[p.status] || [p.status, '']; return h`<tr><td>${p.booking?.serviceName || '-'}<br><small class="muted">${p.booking?.seniorName || ''} · ${p.booking ? fmtDate(p.booking.start) : ''}${p.caregiverName ? ' · ' + p.caregiverName : ''}</small></td><td><strong>${money(p.amount)}</strong><br><small class="muted">${t('TDS')} ${money(p.tds)}</small></td><td><span class="badge ${c}">${t(l)}</span></td><td>${fmtDate(p.paidAt || p.dueAt)}</td></tr>`; })}
    </tbody></table></div></div>`;
  return { title: 'Earnings', html };
}

// ---------- academy ----------
const QUIZ = [
  ['A senior refuses a bath. What do you do first?', ['Insist firmly', 'Ask why and offer another time', 'Tell the family to force it'], 1],
  ['Before any care task you should', ['Wash or sanitise hands', 'Start quickly to save time', 'Wear the same gloves as last visit'], 0],
  ['The senior is breathless and confused. You', ['Wait and watch', 'Press SOS and call 108', 'Give them their evening tablet early'], 1],
];
export async function academy(ctx) {
  const list = await api.get('/academy');
  const html = h`<div class="page-head"><h1>${t('ElderLink Academy')}</h1><p>${t('Finish the 6 induction modules to get verified. Extra courses earn skill badges that families see.')}</p></div>
    <div class="grid two">${list.map((c) => h`<div class="card"><div class="row between"><h3 style="margin:0">${t(c.title)}</h3>${c.progress?.passed ? h`<span class="badge green">${icon('check', 12)} ${t('Passed')} ${c.progress.score}%</span>` : c.induction ? h`<span class="badge">${t('Induction')}</span>` : h`<span class="badge brand">${t('Badge')}</span>`}</div>
      <p class="muted">${t('Short video in Hindi, Kannada or English, then 3 questions.')}</p><button class="btn small ${c.progress?.passed ? 'ghost' : ''}" data-course="${c.id}">${c.progress?.passed ? t('Retake') : t('Start')}</button></div>`)}</div>`;
  return {
    title: 'Academy', html,
    mount(el) {
      el.querySelectorAll('[data-course]').forEach((b) => b.onclick = () => modal(h`<h2>${t(list.find((c) => c.id === b.dataset.course).title)}</h2>
        <div class="card flat" style="text-align:center;padding:24px">${icon('video', 40)}<p class="muted">${t('Video lesson (demo)')}</p></div><form id="q">
        ${QUIZ.map(([q, opts], i) => h`<fieldset class="quiz-q"><legend><strong>${i + 1}. ${t(q)}</strong></legend>${opts.map((o, j) => h`<label class="check"><input type="radio" name="q${i}" value="${j}" required> ${t(o)}</label>`)}</fieldset>`)}
        <button class="btn block">${t('Submit answers')}</button></form>`, (m, close) => {
        m.querySelector('#q').onsubmit = async (e) => {
          e.preventDefault();
          const f = formData(e.target);
          const right = QUIZ.filter(([, , a], i) => Number(f['q' + i]) === a).length;
          const score = Math.round((right / QUIZ.length) * 100);
          const r = await api.post(`/academy/${b.dataset.course}/complete`, { score });
          close(); toast(r.passed ? `${t('Passed')} (${score}%). ${t('Induction score')}: ${r.inductionScore}%` : `${score}%. ${t('You need 80% to pass. Try again.')}`, !r.passed); ctx.refresh();
        };
      }));
    },
  };
}

// ---------- verification profile ----------
export async function profile(ctx) {
  const d = await api.get('/my/verification');
  const c = d.caregiver;
  const [vl, vc] = VSTATUS[c.status] || [c.status, ''];
  const checks = c.verification || {};
  const chk = { pass: ['Passed', 'green'], pending: ['Pending', ''], fail: ['Failed', 'red'] };
  const editable = ['draft', 'rejected'].includes(c.status);
  const nurse = ['RN', 'GNM', 'ANM'].includes(c.category);
  const html = h`<div class="page-head row between"><div><h1>${t('My profile and verification')}</h1><p>${c.name} · <span class="badge ${vc}">${t(vl)}</span></p></div><span class="avatar lg">${initials(c.name)}</span></div>
    <div class="card"><h2>${t('Background checks')}</h2><p class="muted">${t('Done by our verification partner. Families see a Verified badge only when all pass.')}</p>
      <div class="grid three">${[['id', 'Aadhaar e-KYC'], ['registration', 'Nursing council registration'], ['police', 'Police verification'], ['references', 'References'], ['interview', 'Interview and skills test']].filter(([k]) => k !== 'registration' || nurse).map(([k, l]) => { const [s, cc] = chk[checks[k]] || chk.pending; return h`<div class="stat"><div class="l">${t(l)}</div><span class="badge ${cc}">${t(s)}</span></div>`; })}
        <div class="stat"><div class="l">${t('Induction score')}</div><div class="n">${c.inductionScore || 0}%</div><a href="#/cg/academy">${t('Academy')}</a></div></div>
      ${c.statusReason ? h`<div class="alert amber">${icon('info')}<span>${c.statusReason}</span></div>` : ''}
      ${c.registrationExpiry ? h`<p class="muted">${t('Registration valid until')} ${fmtDate(Date.parse(c.registrationExpiry))}</p>` : ''}</div>
    <form id="f" class="card"><h2>${t('Details and documents')}</h2>
      <label>${t('I am a')}</label><select name="category" ${editable ? '' : 'disabled'}>${[['RN', 'Registered Nurse (B.Sc / RN)'], ['GNM', 'GNM nurse'], ['ANM', 'ANM nurse'], ['GDA', 'Attendant (GDA)'], ['PHYSIO', 'Physiotherapist'], ['COMPANION', 'Companion'], ['CONCIERGE', 'Helper / errands']].map(([v, l]) => h`<option value="${v}" ${v === c.category ? 'selected' : ''}>${t(l)}</option>`)}</select>
      <label>${t('Nursing / council registration number')} ${nurse ? '' : h`<span class="hint">(${t('nurses only')})</span>`}</label><input name="registrationNo" value="${c.registrationNo || ''}" ${editable ? '' : 'disabled'}>
      <label>${t('Registration valid until')}</label><input type="date" name="registrationExpiry" value="${c.registrationExpiry || ''}" ${editable ? '' : 'disabled'}>
      <label>PAN</label><input name="pan" value="${c.pan || ''}" ${editable ? '' : 'disabled'} placeholder="ABCDE1234F">
      <div class="grid two"><div><label>${t('Bank')}</label><input name="bankName" value="${c.bank?.bank || ''}" ${editable ? '' : 'disabled'}></div><div><label>${t('Account last 4 digits')}</label><input name="bankLast4" value="${c.bank?.last4 || ''}" inputmode="numeric" maxlength="4" ${editable ? '' : 'disabled'}></div></div>
      <label>${t('Years of experience')}</label><input name="experienceYears" inputmode="numeric" value="${c.experienceYears || ''}" ${editable ? '' : 'disabled'}>
      <label>${t('About you (families read this)')}</label><textarea name="bio" rows="3" ${editable ? '' : 'disabled'}>${c.bio || ''}</textarea>
      <label>${t('Documents')}</label><div class="btn-row"><button type="button" class="btn soft small" data-up ${editable ? '' : 'disabled'}>${icon('upload', 18)} ${t('Upload certificate')}</button><button type="button" class="btn soft small" data-up ${editable ? '' : 'disabled'}>${icon('camera', 18)} ${t('Take a selfie for ID match')}</button></div>
      ${editable ? h`<div class="btn-row" style="margin-top:14px"><button class="btn soft" name="save">${t('Save')}</button><button class="btn" data-submit>${t('Submit for verification')}</button></div>` : ''}
    </form>
    ${d.log.length ? h`<div class="card"><h2>${t('History')}</h2><ul class="timeline">${d.log.slice().reverse().map((l) => h`<li><time>${fmtDateTime(l.createdAt)}</time>${t(l.to)} · ${l.reason || ''} <span class="muted">(${l.by})</span></li>`)}</ul></div>` : ''}`;
  return {
    title: 'Profile', html,
    mount(el) {
      const f = el.querySelector('#f');
      const send = async (submit) => {
        const v = formData(f);
        const body = { category: v.category, registrationNo: v.registrationNo, registrationExpiry: v.registrationExpiry, pan: v.pan, bio: v.bio, experienceYears: Number(v.experienceYears) || 0, submit };
        if (v.bankName) body.bank = { bank: v.bankName, last4: v.bankLast4, verified: false };
        try { await api.patch('/my/verification', body); toast(submit ? t('Submitted. We will update you within 5 working days.') : t('Saved')); ctx.refresh(); } catch (e) { toast(e.message, true); }
      };
      f.onsubmit = (e) => { e.preventDefault(); send(e.submitter?.hasAttribute('data-submit')); };
      el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => toast(t('Document attached (demo)')));
    },
  };
}

