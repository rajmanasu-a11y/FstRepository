// Screens shared by all roles: booking detail (FR-BKG), SOS case view (FR-EMG-10), invoices (FR-PAY-07),
// notifications (FR-NTF), settings with consent ledger (FR-ONB-02, 09, NFR accessibility) and help / grievances (FR-GRV).
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, formData, fmtTime, fmtDate, fmtDateTime, fmtDay, money, stars, statusBadge, empty, ago, initials, speak } from '../ui.js';
import { signOut } from '../app.js';

const back = (href, label = 'Back') => h`<a class="back" href="${href}">${icon('back')} ${t(label)}</a>`;
const GRIEVANCE_CATEGORIES = ['No-show', 'Late', 'Quality of care', 'Behaviour', 'Safety / abuse', 'Billing', 'Data privacy', 'App issue'];
const LIGHT = { green: 'Normal', amber: 'Watch', red: 'Needs a doctor' };

function homeFor(user) { return { family: '#/bookings', senior: '#/senior', caregiver: '#/cg', provider_admin: '#/prv/bookings', coordinator: '#/ops', emergency: '#/ops/desk', admin: '#/ops' }[user.role] || '#/home'; }

// ---------- booking detail ----------
export async function booking(ctx) {
  const b = await api.get(`/bookings/${ctx.params.id}`);
  const u = ctx.user;
  if (u.role === 'caregiver' && b.caregiver?.id && b.careProfile) { location.replace(`#/cg/visit/${b.id}`); return { html: '' }; }
  const family = ['owner', 'manager'].includes(b.myRole);
  const isSelf = b.myRole === 'self';
  const providerSide = u.role === 'provider_admin' || u.role === 'caregiver';
  const p = b.price || {};
  const r = b.report;
  const html = h`${back(homeFor(u))}
    <div class="page-head"><h1>${tf(b, 'serviceName')}</h1><p>${b.seniorName} · ${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)}–${fmtTime(b.end)} · ${statusBadge(b.status)}</p></div>
    ${b.status === 'pending_approval' && family ? h`<div class="alert amber">${icon('alert')}<span>${b.source === 'senior_request' ? `${b.seniorName.split(' ')[0]} ${t('asked for this.')}` : t('This booking is above your approval limit.')} ${t('Approve to pay and send it to the provider.')}</span></div>
      <div class="btn-row"><button class="btn" data-act="approve">${icon('check', 20)} ${t('Approve and pay')} ${money(p.total)}</button><button class="btn ghost" data-act="reject">${t('Decline')}</button></div>` : ''}
    ${b.status === 'completed' && (family || isSelf) ? h`<div class="alert amber">${icon('info')}<span>${t('The visit is done. Please confirm, or raise an issue within 24 hours. Payment is released to the provider after you confirm.')}</span></div>
      <div class="btn-row"><button class="btn" data-act="confirm">${icon('check', 20)} ${t('Confirm visit')}</button>${b.canReview ? h`<a class="btn soft" href="#/review/${b.id}">${icon('star', 20)} ${t('Rate the visit')}</a>` : ''}<button class="btn ghost" data-issue>${icon('flag', 20)} ${t('Raise an issue')}</button></div>` : ''}
    ${['confirmed', 'paid_out'].includes(b.status) && b.canReview ? h`<div class="alert">${icon('star')}<span>${t('How was it? Your review helps other families.')}</span><a class="btn small" href="#/review/${b.id}">${t('Rate the visit')}</a></div>` : ''}
    ${b.status === 'in_progress' ? h`<div class="alert green">${icon('check')}<span>${b.caregiverName} ${t('is at the home now. Checked in at')} ${fmtTime(b.checkInAt)} (${b.checkInDistanceM} m, ${t('code verified')}).</span></div>` : ''}
    <div class="grid two">
      <div class="card"><h2>${t('Who is coming')}</h2>
        ${b.caregiver ? h`<div class="row"><span class="avatar lg">${initials(b.caregiver.name)}</span><div><strong>${b.caregiver.name}</strong><br><span class="muted">${t(b.caregiver.category || '')} · ${b.providerName}</span><br>${(b.caregiver.badges || []).map((x) => h`<span class="badge green">${icon('check', 12)} ${t(x)}</span> `)}</div></div>`
          : h`<p><strong>${b.providerName}</strong><br><span class="muted">${b.status === 'requested' ? t('Waiting for the provider to accept (up to 2 hours).') : t('A verified caregiver will be assigned.')}</span></p>`}
        ${b.visitCode && OPEN(b.status) ? h`<p style="margin:12px 0 4px"><strong>${t('Visit code')}</strong> <small class="muted">${t('share only when the caregiver is at the door')}</small></p><div class="code-box" aria-label="${b.visitCode.split('').join(' ')}">${b.visitCode}</div>` : ''}
        ${!providerSide && b.caregiver && OPEN(b.status) ? h`<div class="btn-row" style="margin-top:12px"><button class="btn soft small" data-call>${icon('phone', 18)} ${t('Call caregiver (masked)')}</button></div>` : ''}
      </div>
      <div class="card"><h2>${t('Details')}</h2><dl class="kv">
        <dt>${t('Address')}</dt><dd>${b.seniorAddress || b.seniorArea || '-'}</dd>
        ${b.addOns?.length ? h`<dt>${t('Add-ons')}</dt><dd>${b.addOns.map((a) => a.name).join(', ')}</dd>` : ''}
        ${b.notes ? h`<dt>${t('Notes')}</dt><dd>${b.notes}</dd>` : ''}
        ${b.recurrenceId ? h`<dt>${t('Repeats')}</dt><dd>${t('Part of a repeating booking')}</dd>` : ''}
        <dt>${t('Booking ID')}</dt><dd>${b.id}</dd></dl>
        ${p.total != null ? h`<h3>${t('Price')}</h3><dl class="kv">
          <dt>${t('Care')}</dt><dd>${money(p.careValue)}${p.discount ? h` <small class="muted">(${t('incl. plan discount')} -${money(p.discount)})</small>` : ''}</dd>
          <dt>${t('Platform fee + GST')}</dt><dd>${money((p.platformFee || 0) + (p.gst || 0))}</dd>
          <dt><strong>${t('Total')}</strong></dt><dd><strong>${money(p.total)}</strong>${b.payment ? h` <small class="muted">· ${t(b.payment.status === 'escrow' ? 'held safely until visit is confirmed' : b.payment.status)}</small>` : ''}</dd>
          ${b.payment?.refunded ? h`<dt>${t('Refunded')}</dt><dd>${money(b.payment.refunded)}</dd>` : ''}
          ${providerSide && p.providerShare != null ? h`<dt>${t('Your share')}</dt><dd>${money(p.providerShare)} ${b.payout ? h`<span class="badge">${t(b.payout.status)}</span>` : ''}</dd>` : ''}
        </dl>` : ''}
        ${b.invoices?.length ? h`<div class="btn-row">${b.invoices.map((id, i) => h`<a class="btn ghost small" href="#/invoice/${id}">${icon('doc', 18)} ${i === 0 ? t('Care invoice') : t('Platform fee invoice')}</a>`)}</div>` : ''}
      </div>
    </div>
    ${r ? h`<div class="card"><div class="row between"><h2 style="margin:0">${t('Visit report')}</h2><button class="btn ghost small" data-read>${icon('volume', 18)} ${t('Read aloud')}</button></div>
      <p class="muted">${t('By')} ${r.by} · ${fmtDateTime(b.checkOutAt)}</p>
      ${r.traffic ? h`<div class="chips" style="margin-bottom:10px">${Object.entries(r.traffic).map(([k, v]) => h`<span class="chip"><span class="light ${v}"></span> ${t({ vitals: 'Vitals', medicines: 'Medicines', home: 'Home safety', mood: 'Mood', nutrition: 'Food and water' }[k])}</span>`)}</div>` : ''}
      ${Object.keys(r.vitals || {}).length ? h`<div class="grid four">${[['BP', r.vitals.bpSys ? `${r.vitals.bpSys}/${r.vitals.bpDia}` : null], [t('Sugar'), r.vitals.sugar], ['SpO2', r.vitals.spo2 && r.vitals.spo2 + '%'], [t('Pulse'), r.vitals.pulse], [t('Temp'), r.vitals.temp], [t('Weight'), r.vitals.weight]].filter((x) => x[1]).map(([l, v]) => h`<div class="stat"><div class="l">${l}</div><div class="n">${v}</div></div>`)}</div>
        ${r.vitalsStatus ? h`<p class="row"><span class="light ${r.vitalsStatus.overall}"></span> ${t(LIGHT[r.vitalsStatus.overall])}</p>` : ''}` : ''}
      <h3>${t('Done during the visit')}</h3><ul class="ticks">${(r.checklistItems || []).map((i) => h`<li style="${r.checklist[i] ? '' : 'opacity:.55'}">${icon(r.checklist[i] ? 'check' : 'x', 18)} ${t(i)}</li>`)}</ul>
      ${r.observations ? h`<h3>${t('Notes from the caregiver')}</h3><p>${r.observations}</p>` : ''}
      ${r.mood ? h`<p><strong>${t('Mood')}:</strong> ${t(r.mood)}</p>` : ''}
    </div>` : ''}
    ${b.reviews?.length ? h`<div class="card"><h2>${t('Reviews')}</h2>${b.reviews.map((rv) => h`<div style="margin-bottom:.6rem"><span class="stars">${stars(rv.score)}</span> <strong>${rv.reviewerLabel}</strong> ${rv.status === 'held' ? h`<span class="badge amber">${t('being checked')}</span>` : ''}<p>${rv.text}</p>${rv.reply ? h`<p class="muted">${t('Reply from')} ${rv.reply.by}: ${rv.reply.text}</p>` : ''}</div>`)}</div>` : ''}
    ${providerSide && b.status === 'requested' && u.role === 'provider_admin' ? h`<div class="btn-row"><button class="btn" data-pact="accept">${t('Accept')}</button><button class="btn ghost" data-pact="decline">${t('Decline')}</button></div>` : ''}
    <div class="card"><h2>${t('Timeline')}</h2><ul class="timeline">${(b.timeline || []).slice().reverse().map((x) => h`<li><time>${fmtDateTime(x.at)}</time>${x.text}</li>`)}</ul></div>
    ${family && OPEN(b.status) && b.status !== 'in_progress' && b.status !== 'pending_approval' ? h`<div class="btn-row">
      ${b.listingId && ['requested', 'accepted', 'assigned'].includes(b.status) ? h`<button class="btn soft" data-resched>${icon('calendar', 20)} ${t('Change time')}</button>` : ''}
      <button class="btn ghost" data-cancel>${t('Cancel booking')}</button></div>` : ''}
    ${(family || isSelf) && ['assigned', 'in_progress', 'no_show', 'confirmed'].includes(b.status) ? h`<p><button class="btn ghost small" data-issue>${icon('flag', 18)} ${t('Report a problem')}</button></p>` : ''}`;
  return {
    title: 'Booking', html,
    mount(el) {
      const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); ctx.refresh(); } catch (e) { toast(e.message, true); } };
      el.querySelectorAll('[data-act]').forEach((x) => x.onclick = () => {
        const a = x.dataset.act;
        if (a === 'approve') return run(() => api.post(`/bookings/${b.id}/approve`, { method: 'upi' }), t('Approved and paid. The provider has been asked.'));
        if (a === 'reject') return run(() => api.post(`/bookings/${b.id}/reject`, {}), t('Declined'));
        if (a === 'confirm') return run(() => api.post(`/bookings/${b.id}/confirm`), t('Thank you. Payment released to the provider.'));
      });
      el.querySelectorAll('[data-pact]').forEach((x) => x.onclick = () => run(() => api.post(`/bookings/${b.id}/${x.dataset.pact}`, {}), x.dataset.pact === 'accept' ? t('Accepted. Assign a caregiver next.') : t('Declined. The family gets a full refund.')));
      el.querySelector('[data-call]')?.addEventListener('click', async () => { const r2 = await api.post(`/bookings/${b.id}/call`, { to: 'caregiver' }); toast(r2.message); });
      el.querySelector('[data-read]')?.addEventListener('click', () => speak(`${t('Visit report')}. ${r.by}. ${r.observations || ''}`));
      el.querySelectorAll('[data-issue]').forEach((x) => x.onclick = () => issueDialog(b, ctx));
      el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
        const pv = b.status === 'pending_approval' ? { charge: 0 } : await api.get(`/bookings/${b.id}/cancel-preview`);
        const msg = pv.charge ? `${t('Cancelling now has a charge of')} ${money(pv.charge)} (${pv.pct}%). ${t('The rest is refunded.')}` : t('Cancel for free? You get a full refund.');
        if (!(await confirmBox(msg, { ok: t('Cancel booking'), cancel: t('Keep booking'), danger: true }))) return;
        run(() => api.post(`/bookings/${b.id}/cancel`, { reason: 'Cancelled by family' }), t('Cancelled. Refund started.'));
      });
      el.querySelector('[data-resched]')?.addEventListener('click', async () => {
        const days = await api.get(`/listings/${b.listingId}/slots`, { days: 7 });
        modal(h`<h2>${t('Change time')}</h2><p class="muted">${t('Free up to 12 hours before the visit.')}</p>${days.map((d) => { const free = d.slots.filter((s) => s.free); return free.length ? h`<h3>${fmtDay(Date.parse(d.date + 'T06:30:00Z'), ctx.now)}</h3><div class="chips">${free.map((s) => h`<button class="chip" data-slot="${s.start}">${fmtTime(s.start)}</button>`)}</div>` : ''; })}`, (m, close) => {
          m.querySelectorAll('[data-slot]').forEach((s) => s.onclick = async () => { close(); run(() => api.post(`/bookings/${b.id}/reschedule`, { start: Number(s.dataset.slot) }), t('Moved. The caregiver has been told.')); });
        });
      });
    },
  };
}
function OPEN(s) { return ['pending_approval', 'requested', 'accepted', 'assigned', 'in_progress'].includes(s); }

function issueDialog(b, ctx) {
  modal(h`<h2>${t('Raise an issue')}</h2><p class="muted">${t('The payment stays on hold while we look into it. Safety concerns are handled within 1 hour.')}</p><form id="f">
    <label>${t('What went wrong?')}</label><select name="category">${GRIEVANCE_CATEGORIES.filter((c) => c !== 'App issue' && c !== 'Data privacy').map((c) => h`<option>${t(c)}</option>`)}</select>
    <label>${t('Tell us more')}</label><textarea name="text" rows="4" required></textarea>
    <button class="btn block danger" style="margin-top:12px">${t('Send')}</button></form>`, (m, close) => {
    m.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const idx = [...m.querySelector('select').options].findIndex((o) => o.selected);
      const category = GRIEVANCE_CATEGORIES.filter((c) => c !== 'App issue' && c !== 'Data privacy')[idx];
      try { await api.post(`/bookings/${b.id}/issue`, { category, text: f.text }); close(); toast(t('Sent. A coordinator will contact you.')); ctx.refresh(); } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- SOS case (family / senior view) ----------
export async function caseView(ctx) {
  const c = await api.get(`/cases/${ctx.params.id}`);
  if (['emergency', 'coordinator', 'admin'].includes(ctx.user.role)) { location.replace(`#/ops/case/${c.id}`); return { html: '' }; }
  const closed = c.status === 'closed';
  const stage = closed ? 'Closed' : c.ambulance ? (c.ambulance.arrivedAt ? 'Ambulance at the home' : 'Ambulance on the way') : c.status === 'open' ? 'Alerting the desk' : 'Desk is handling it';
  const html = h`${back(ctx.user.role === 'senior' ? '#/senior' : '#/home')}
    <div class="card ${closed ? '' : 'sos-live'}" style="${closed ? '' : 'border-color:var(--red)'}">
      <div class="row between"><h1 style="margin:0">${icon('siren')} SOS: ${c.seniorName}</h1><span class="badge ${closed ? 'green' : 'red'}">${t(stage)}</span></div>
      <p class="muted">${t('Raised')} ${fmtDateTime(c.createdAt)} · ${t(c.trigger)}${c.agentName ? ` · ${t('Handled by')} ${c.agentName}` : ''}</p>
      ${c.ambulance ? h`<div class="alert ${c.ambulance.arrivedAt ? 'green' : 'amber'}">${icon('hospital')}<span><strong>${c.ambulance.partner}</strong> · ${c.ambulance.vehicle}<br>${c.ambulance.arrivedAt ? t('Arrived at') + ' ' + fmtTime(c.ambulance.arrivedAt) : t('ETA') + ' ' + c.ambulance.eta + ' ' + t('min from') + ' ' + fmtTime(c.ambulance.dispatchedAt)}</span></div>` : ''}
      ${c.hospital ? h`<p><strong>${t('Hospital')}:</strong> ${c.hospital}</p>` : ''}
      ${closed ? h`<p><strong>${t('Outcome')}:</strong> ${c.outcome}</p>` : h`<p>${t('Stay on the line if the desk calls. This page updates by itself.')}</p>`}
      <div class="btn-row"><a class="btn danger" href="tel:112">${icon('phone', 20)} ${t('Call 112')}</a><a class="btn soft" href="tel:108">${icon('phone', 20)} ${t('Call 108 ambulance')}</a></div>
    </div>
    <div class="card"><h2>${t('What is happening')}</h2><ul class="timeline">${c.timeline.slice().reverse().map((x) => h`<li class="${['dispatch', 'trigger'].includes(x.kind) ? 'red' : ''}"><time>${fmtTime(x.at)} · ${ago(x.at, ctx.now)}</time>${x.text}</li>`)}</ul></div>
    <div class="card"><h2>${t('Medical summary shared with responders')}</h2><dl class="kv"><dt>${t('Blood group')}</dt><dd>${c.summary.bloodGroup || '-'}</dd><dt>${t('Conditions')}</dt><dd>${(c.summary.conditions || []).join(', ')}</dd><dt>${t('Allergies')}</dt><dd>${(c.summary.allergies || []).join(', ') || '-'}</dd><dt>${t('Medicines')}</dt><dd>${(c.summary.medicines || []).join(', ')}</dd></dl></div>`;
  let timer;
  return {
    title: 'SOS', html,
    mount() { if (!closed) timer = setInterval(() => { if (!location.hash.startsWith(`#/case/${c.id}`)) return clearInterval(timer); ctx.refresh(); }, 8000); },
  };
}

// ---------- invoice ----------
export async function invoice(ctx) {
  const inv = await api.get(`/invoices/${ctx.params.id}`);
  const html = h`<div class="no-print">${back(`#/booking/${inv.bookingId}`)}<button class="btn soft" data-print>${icon('print', 20)} ${t('Print or save as PDF')}</button></div>
    <div class="card print-sheet"><div class="row between top"><div><h1 style="margin:0">${t('Tax invoice')}</h1><p class="muted">${inv.number} · ${fmtDate(inv.createdAt)}</p></div><span class="logo">${icon('heart', 28)}</span></div>
      <dl class="kv"><dt>${t('Issued by')}</dt><dd>${inv.issuer}</dd><dt>GSTIN</dt><dd>${inv.issuerGstin}</dd><dt>${t('Booking')}</dt><dd>${inv.bookingId}</dd></dl>
      <table><thead><tr><th>${t('Item')}</th><th style="text-align:right">${t('Amount')}</th></tr></thead><tbody>
        ${inv.lines.map((l) => h`<tr><td>${l.text}</td><td style="text-align:right">${money(l.amount)}</td></tr>`)}
        ${inv.gst ? h`<tr><td>GST 18% (CGST 9% + SGST 9%) on ${money(inv.taxable)}</td><td style="text-align:right">${money(inv.gst)}</td></tr>` : ''}
        <tr><td><strong>${t('Total')}</strong></td><td style="text-align:right"><strong>${money(inv.total)}</strong></td></tr></tbody></table>
      <p class="muted" style="font-size:.9rem;margin-top:1rem">${inv.note} ${t('Demo invoice: not a real tax document.')}</p></div>`;
  return { title: 'Invoice', html, mount(el) { el.querySelector('[data-print]').onclick = () => window.print(); } };
}

// ---------- notifications ----------
export async function notifications(ctx) {
  const list = await api.get('/me/notifications');
  const html = h`<div class="page-head row between"><h1>${t('Notifications')}</h1>${list.some((n) => !n.read) ? h`<button class="btn soft small" data-read>${t('Mark all read')}</button>` : ''}</div>
    ${list.length ? h`<div class="card">${list.map((n) => h`<div class="queue-row" style="${n.read ? 'opacity:.7' : ''}"><div>${!n.read ? h`<span class="badge brand">${t('new')}</span> ` : ''}${n.critical ? h`<span class="badge red">${t('urgent')}</span> ` : ''}<strong>${t(n.title)}</strong><br>${n.body}<br><small class="muted">${ago(n.createdAt, ctx.now)}</small></div></div>`)}</div>`
      : empty(t('Nothing yet. Updates about visits, medicines and SOS appear here.'))}
    <p class="muted">${t('Urgent alerts (SOS, missed critical medicine, abnormal vitals) also come by SMS and a phone call, even during quiet hours.')}</p>`;
  return { title: 'Notifications', html, mount(el) { el.querySelector('[data-read]')?.addEventListener('click', async () => { await api.post('/me/notifications/read'); ctx.refresh(); }); } };
}

// ---------- settings ----------
export async function settings(ctx) {
  const consents = await api.get('/me/consents');
  const u = ctx.user;
  const p = u.prefs || {};
  const seniorOn = u.role === 'senior' ? p.seniorMode !== false : !!p.seniorMode;
  const opt = (name, val, cur, label) => h`<label><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><span>${label}</span></label>`;
  const html = h`${u.role === 'senior' ? back('#/senior/more') : ''}
    <div class="page-head"><h1>${t('Settings')}</h1><p>${u.name} · ${u.mobile}</p></div>
    <div class="card"><h2>${icon('text')} ${t('Easy to read')}</h2>
      <label class="check big"><input type="checkbox" data-pref="seniorMode" ${seniorOn ? 'checked' : ''}> <span><strong>${t('Senior mode')}</strong><br><small class="muted">${t('Bigger buttons, fewer choices on each screen, voice read-out')}</small></span></label>
      <label>${t('Text size')}</label><div class="seg" role="radiogroup">${opt('textSize', 'normal', p.textSize || 'normal', t('Normal'))}${opt('textSize', 'xl', p.textSize, t('Large'))}${opt('textSize', 'xxl', p.textSize, t('Extra large'))}</div>
      <label class="check"><input type="checkbox" data-pref="contrast" ${p.contrast ? 'checked' : ''}> ${t('High contrast')}</label>
      <label>${t('Theme')}</label><div class="seg" role="radiogroup">${opt('theme', 'auto', p.theme || 'auto', t('Same as phone'))}${opt('theme', 'light', p.theme, t('Light'))}${opt('theme', 'dark', p.theme, t('Dark'))}</div>
      <label>${t('Language')}</label><div class="seg" role="radiogroup">${opt('language', 'en', u.language || 'en', 'English')}${opt('language', 'hi', u.language, 'हिन्दी')}</div>
    </div>
    <div class="card"><h2>${icon('bell')} ${t('Quiet hours')}</h2><p class="muted">${t('Normal updates wait until morning. Urgent alerts always come through.')}</p>
      <div class="row" style="gap:12px"><label>${t('From')} <input type="time" data-q="from" value="${p.quiet?.from || '22:00'}"></label><label>${t('To')} <input type="time" data-q="to" value="${p.quiet?.to || '07:00'}"></label><button class="btn small soft" data-quiet>${t('Save')}</button></div></div>
    <div class="card"><h2>${icon('lock')} ${t('Your data and consent')}</h2><p class="muted">${t('Under the Digital Personal Data Protection Act you can see, change or withdraw each consent.')}</p>
      ${consents.current.map((c) => h`<div class="queue-row"><div><strong>${t(c.label)}</strong>${c.required ? h` <span class="hint">(${t('needed to use ElderLink')})</span>` : ''}<br><small class="muted">${c.granted ? t('Given') : t('Not given')}${c.at ? ' · ' + fmtDate(c.at) : ''}</small></div>
        <button class="btn small ${c.granted ? 'ghost' : 'soft'}" data-consent="${c.id}" data-g="${c.granted ? '0' : '1'}">${c.granted ? t('Withdraw') : t('Give consent')}</button></div>`)}
      <details style="margin-top:.6rem"><summary>${t('Consent history')}</summary><ul class="timeline">${consents.ledger.map((l) => h`<li><time>${fmtDateTime(l.at)}</time>${l.purpose}: ${l.granted ? t('given') : t('withdrawn')} (${l.version})</li>`)}</ul></details>
      <div class="btn-row" style="margin-top:12px"><button class="btn soft small" data-export>${icon('doc', 18)} ${t('Download my data')}</button><button class="btn ghost small" data-delete>${t('Delete my account')}</button></div></div>
    <div class="btn-row"><a class="btn ghost" href="#/help">${icon('chat', 20)} ${t('Help and complaints')}</a><button class="btn ghost" data-logout>${icon('logout', 20)} ${t('Sign out')}</button></div>`;
  return {
    title: 'Settings', html,
    mount(el) {
      const save = async (patch) => { try { ctx.state.user = await api.patch('/me', patch); try { if (patch.language) localStorage.setItem('elderlink.lang', patch.language); if (patch.prefs?.theme) localStorage.setItem('elderlink.theme', patch.prefs.theme); } catch { /* ignore */ } ctx.refresh(); } catch (e) { toast(e.message, true); } };
      el.querySelectorAll('[data-pref]').forEach((c) => c.onchange = () => save({ prefs: { [c.dataset.pref]: c.checked } }));
      el.querySelectorAll('input[name=textSize]').forEach((r) => r.onchange = () => save({ prefs: { textSize: r.value } }));
      el.querySelectorAll('input[name=theme]').forEach((r) => r.onchange = () => save({ prefs: { theme: r.value } }));
      el.querySelectorAll('input[name=language]').forEach((r) => r.onchange = () => save({ language: r.value }));
      el.querySelector('[data-quiet]').onclick = () => save({ prefs: { quiet: { from: el.querySelector('[data-q=from]').value, to: el.querySelector('[data-q=to]').value } } });
      el.querySelectorAll('[data-consent]').forEach((b) => b.onclick = async () => {
        const granted = b.dataset.g === '1';
        if (!granted && !(await confirmBox(t('Withdraw this consent?'), { ok: t('Withdraw'), danger: true }))) return;
        const r = await api.post('/me/consents', { purpose: b.dataset.consent, granted });
        toast(r.warning ? t(r.warning) : t('Saved'), !!r.warning); ctx.refresh();
      });
      el.querySelector('[data-export]').onclick = async () => {
        const data = await api.get('/me/export');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = 'elderlink-my-data.json'; a.click();
        toast(t('Your data file is downloading'));
      };
      el.querySelector('[data-delete]').onclick = async () => {
        if (!(await confirmBox(t('Delete your account? This cannot be undone after 30 days.'), { ok: t('Delete'), danger: true }))) return;
        const r = await api.post('/me/delete'); toast(t(r.message));
      };
      el.querySelector('[data-logout]').onclick = () => signOut();
    },
  };
}

// ---------- help and grievances ----------
export async function help(ctx) {
  const mine = await api.get('/grievances');
  const officer = mine[0]?.officer || { name: 'Ms. Anjali Deshpande', email: 'grievance@elderlink.example', phone: '080-4000-1930' };
  const st = { open: ['Received', 'amber'], in_progress: ['Being looked at', 'info'], resolved: ['Resolved', 'green'] };
  const html = h`${ctx.user.role === 'senior' ? back('#/senior/more') : ''}
    <div class="page-head"><h1>${t('Help and complaints')}</h1><p>${t('We reply within 48 hours and resolve within 30 days. Safety concerns get a call within 1 hour.')}</p></div>
    <div class="grid two">
      <div class="card"><h2>${t('Urgent?')}</h2><div class="stack">
        <a class="btn danger block" href="tel:112">${icon('phone', 20)} ${t('Emergency')}: 112</a>
        <a class="btn soft block" href="tel:108">${icon('phone', 20)} ${t('Ambulance')}: 108</a>
        <a class="btn soft block" href="tel:14567">${icon('phone', 20)} Elderline: 14567</a>
        <a class="btn soft block" href="tel:1930">${icon('shield', 20)} ${t('Cyber fraud')}: 1930</a></div></div>
      <div class="card"><h2>${t('Make a complaint')}</h2><form id="f">
        <label>${t('About')}</label><select name="category">${GRIEVANCE_CATEGORIES.map((c) => h`<option value="${c}">${t(c)}</option>`)}</select>
        <label>${t('What happened?')}</label><textarea name="text" rows="4" required></textarea>
        <button class="btn block" style="margin-top:12px">${t('Send complaint')}</button></form></div>
    </div>
    <div class="card"><h2>${t('My complaints')}</h2>${mine.length ? mine.map((g) => { const [l, c] = st[g.status] || [g.status, '']; return h`<div class="queue-row"><div><strong>${t(g.subject || g.category)}</strong> <span class="badge ${c}">${t(l)}</span>${g.priority === 'P0' ? h` <span class="badge red">P0</span>` : ''}<br><small class="muted">${g.id} · ${fmtDate(g.createdAt)}</small>${g.resolution ? h`<p>${t('Resolution')}: ${g.resolution}</p>` : ''}</div></div>`; }) : h`<p class="muted">${t('No complaints.')}</p>`}</div>
    <div class="card flat"><h3>${t('Grievance officer')}</h3><p>${officer.name} · ${officer.email} · ${officer.phone}</p><p class="muted">${t('If you are not satisfied, you can approach the Data Protection Board of India or the consumer helpline 1915.')}</p></div>`;
  return {
    title: 'Help', html,
    mount(el) {
      el.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        try { await api.post('/grievances', formData(e.target)); toast(t('Complaint received. We have sent you the reference by SMS.')); ctx.refresh(); } catch (err) { toast(err.message, true); }
      };
    },
  };
}
