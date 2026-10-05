// Operations console: coordinator overview, 24x7 SOS desk (FR-ADM-04, FR-EMG-04..11), verification queue
// (FR-ADM-02, FR-VER), check-visit assignment (FR-CHK-02), quality desk (FR-QLT, FR-REV-08) and grievances (FR-GRV).
import { api } from '../api.js';
import { t } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, askText, formData, fmtTime, fmtDate, fmtDateTime, fmtDay, money, stars, statusBadge, empty, ago } from '../ui.js';

const back = (href, label = 'Back') => h`<a class="back" href="${href}">${icon('back')} ${t(label)}</a>`;
const secs = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 120 ? `${s}s` : s < 7200 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
const CASE_ST = { open: ['Not acknowledged', 'red'], acknowledged: ['Acknowledged', 'amber'], in_progress: ['In progress', 'amber'], closed: ['Closed', 'green'] };

export async function home(ctx) {
  const d = await api.get('/ops/home');
  const tile = (n, label, href, warn) => h`<a class="stat" href="${href}" style="text-decoration:none;color:inherit;${warn && n ? 'outline:2px solid var(--red)' : ''}"><div class="l">${t(label)}</div><div class="n">${n}</div></a>`;
  const html = h`<div class="page-head"><h1>${t('Operations')}</h1><p>${t('Bengaluru')} · ${fmtDateTime(ctx.now)}</p></div>
    ${d.unackCases ? h`<div class="alert red">${icon('siren')}<span><strong>${d.unackCases} ${t('SOS waiting to be acknowledged')}</strong></span><a class="btn small danger" href="#/ops/desk">${t('Open SOS desk')}</a></div>` : ''}
    <div class="grid four">
      ${tile(d.openCases, 'Open SOS cases', '#/ops/desk', true)}
      ${tile(d.verification, 'Verification queue', '#/ops/verify')}
      ${tile(d.unassignedChecks, 'Check visits to assign', '#/ops/checks', true)}
      ${tile(d.tickets, 'Quality tickets', '#/ops/quality', true)}
      ${tile(d.grievances.length, 'Open complaints', '#/ops/grievances')}
      ${tile(d.priceFlags, 'Prices to review', '#/ops/quality')}
      ${tile(d.heldReviews, 'Reviews held', '#/ops/quality')}
      ${tile(d.supply, 'No-provider requests', '#/ops/quality')}
      ${tile(d.scam, 'Scam reports', '#/ops/quality', true)}
      ${tile(d.followups, 'SOS follow-ups due', '#/ops/desk')}
    </div>
    <div class="grid two">
      <div class="card"><h2>${t('Late visits')}</h2>${d.lateVisits.length ? d.lateVisits.map((b) => h`<div class="queue-row"><div><strong>${b.seniorName}</strong> · ${b.serviceName}<br><small class="muted">${b.caregiverName || t('unassigned')} · ${t('due')} ${fmtTime(b.start)}</small></div><a class="btn small soft" href="#/booking/${b.id}">${t('Open')}</a></div>`) : h`<p class="muted">${t('All visits on time.')}</p>`}</div>
      <div class="card"><h2>${t('Missed daily check-ins today')}</h2>${d.checkinMisses.length ? d.checkinMisses.map((c) => h`<div class="queue-row"><strong>${c.seniorName}</strong><span class="badge red">${t('no answer')}</span></div>`) : h`<p class="muted">${t('Everyone has checked in.')}</p>`}</div>
    </div>
    <div class="card"><h2>${t('Complaints')}</h2>${grievanceRows(d.grievances.slice(0, 6), ctx)}</div>`;
  return { title: 'Operations', html, mount(el) { bindGrievances(el, ctx); } };
}

// ---------- SOS desk ----------
export async function desk(ctx) {
  const [cases, fu] = await Promise.all([api.get('/cases'), api.get('/ops/followups')]);
  const open = cases.filter((c) => c.status !== 'closed');
  const closed = cases.filter((c) => c.status === 'closed').slice(0, 10);
  const html = h`<div class="page-head"><h1>${icon('siren')} ${t('SOS desk')}</h1><p>${t('Target: acknowledge within 60 seconds. Unacknowledged cases escalate to the supervisor at 45 seconds.')}</p></div>
    <div class="card" style="${open.some((c) => c.status === 'open') ? 'border-color:var(--red)' : ''}"><h2>${t('Live cases')}</h2>
      ${open.length ? open.map((c) => { const [l, cc] = CASE_ST[c.status]; const wait = (c.ackAt || ctx.now) - c.createdAt; return h`<div class="queue-row"><div><strong>${c.seniorName}</strong> <span class="badge ${cc}">${t(l)}</span>${c.covered ? h` <span class="badge brand">${t('plan')}</span>` : ''}${c.offline ? h` <span class="badge amber">${t('no data: SMS')}</span>` : ''}<br><small class="muted">${t(c.trigger)} · ${fmtTime(c.createdAt)}${c.type ? ' · ' + t(c.type) : ''}${c.agentName ? ' · ' + c.agentName : ''}</small></div>
        <div class="row"><span class="timer ${!c.ackAt && wait > 60000 ? 'late' : ''}">${c.ackAt ? t('ack in') + ' ' + secs(wait) : secs(wait)}</span>${c.status === 'open' ? h`<button class="btn small danger" data-ack="${c.id}">${t('Acknowledge')}</button>` : ''}<a class="btn small soft" href="#/ops/case/${c.id}">${t('Open')}</a></div></div>`; }) : h`<p class="muted">${t('No live cases.')}</p>`}</div>
    <div class="grid two">
      <div class="card"><h2>${t('24-hour follow-ups due')}</h2>${fu.length ? fu.map((c) => h`<div class="queue-row"><div><strong>${c.seniorName}</strong><br><small class="muted">${c.outcome} · ${t('due')} ${fmtDateTime(c.dueAt)}</small></div><button class="btn small soft" data-fu="${c.id}">${t('Mark done')}</button></div>`) : h`<p class="muted">${t('None due.')}</p>`}</div>
      <div class="card"><h2>${t('Recently closed')}</h2>${closed.map((c) => h`<div class="queue-row"><div><a href="#/ops/case/${c.id}"><strong>${c.seniorName}</strong></a><br><small class="muted">${c.outcome} · ${fmtDateTime(c.closedAt)}</small></div><small>${c.ackAt ? t('ack') + ' ' + secs(c.ackAt - c.createdAt) : ''}</small></div>`)}</div>
    </div>`;
  let timer;
  return {
    title: 'SOS desk', html,
    mount(el) {
      el.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => { try { await api.post(`/cases/${b.dataset.ack}/ack`); ctx.go(`#/ops/case/${b.dataset.ack}`); } catch (e) { toast(e.message, true); } });
      el.querySelectorAll('[data-fu]').forEach((b) => b.onclick = async () => { const notes = await askText(t('Follow-up notes'), { value: 'Called family, senior stable' }); if (!notes) return; try { await api.post(`/cases/${b.dataset.fu}/followup`, { notes }); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      timer = setInterval(() => { if (location.hash !== '#/ops/desk') return clearInterval(timer); ctx.refresh(); }, 10000);
    },
  };
}

export async function deskCase(ctx) {
  const c = await api.get(`/cases/${ctx.params.id}`);
  const s = c.summary;
  const [l, cc] = CASE_ST[c.status];
  const closed = c.status === 'closed';
  const actions = [['call_senior', 'Called senior: answered', 'phone'], ['call_senior_na', 'Called senior: no answer', 'phone'], ['call_contact', 'Call emergency contact', 'users'], ['nearby_caregiver', 'Send nearby caregiver', 'nurse'], ['inform_hospital', 'Inform hospital', 'hospital'], ['call_108', 'Hand off to 108', 'phone'], ['call_112', 'Call 112 police / fire', 'siren'], ['gas_agency', 'Gas agency', 'alert'], ['repair_partner', 'Send repair partner', 'tools']];
  const html = h`${back('#/ops/desk', 'SOS desk')}
    <div class="row between"><h1 style="margin:0">${c.seniorName}, ${s.age}</h1><span class="badge ${cc}">${t(l)}</span></div>
    <p class="muted">${c.id} · ${t(c.trigger)} · ${fmtDateTime(c.createdAt)} · ${c.covered ? t('Plan member') : t('No plan: respond anyway')}${c.offline ? ' · ' + t('raised with no data (SMS)') : ''}</p>
    ${c.status === 'open' ? h`<button class="btn danger block" data-ack>${icon('check', 20)} ${t('Acknowledge now')}</button>` : ''}
    <div class="grid two">
      <div class="card"><h2>${t('Medical summary')}</h2><dl class="kv"><dt>${t('Address')}</dt><dd>${s.address}<br><small class="muted">${t('Location from')} ${t(c.location?.source || '')}: ${c.location?.lat?.toFixed(4)}, ${c.location?.lng?.toFixed(4)}</small></dd>
        <dt>${t('Blood group')}</dt><dd>${s.bloodGroup || '-'}</dd><dt>${t('Conditions')}</dt><dd>${(s.conditions || []).join(', ')}</dd><dt>${t('Allergies')}</dt><dd><strong>${(s.allergies || []).join(', ') || '-'}</strong></dd>
        <dt>${t('Medicines')}</dt><dd>${(s.medicines || []).join(', ')}</dd><dt>${t('Mobility')}</dt><dd>${s.mobility} · ${s.cognition}</dd><dt>${t('Doctor')}</dt><dd>${s.doctor || '-'}</dd><dt>${t('Hospital')}</dt><dd>${s.hospital || '-'}</dd>
        <dt>${t('Contacts')}</dt><dd>${(s.emergencyContacts || []).map((e) => h`${e.name} · ${e.phone} (${e.distanceKm} km)<br>`)}</dd></dl></div>
      <div class="card"><h2>${t('Timeline')}</h2><ul class="timeline">${c.timeline.slice().reverse().map((x) => h`<li class="${x.kind === 'trigger' ? 'red' : ''}"><time>${fmtTime(x.at)} (+${secs(x.at - c.createdAt)})</time>${x.text}</li>`)}</ul></div>
    </div>
    ${!closed && c.status !== 'open' ? h`<div class="card"><h2>1. ${t('Triage')}</h2><form id="tri" class="stack">
        <div class="seg">${['medical', 'safety', 'nonurgent'].map((k) => h`<label><input type="radio" name="type" value="${k}" ${c.type === k ? 'checked' : ''}><span>${t({ medical: 'Medical', safety: 'Safety', nonurgent: 'Non-urgent' }[k])}</span></label>`)}</div>
        <select name="reason">${Object.entries(c.triage).flatMap(([k, arr]) => arr.map((r) => h`<option data-k="${k}" ${c.reason === r ? 'selected' : ''}>${r}</option>`))}</select>
        <button class="btn soft">${t('Save triage')}</button></form></div>
      <div class="card"><h2>2. ${t('Act')}</h2><div class="chips">${actions.map(([k, lab, ic]) => h`<button class="chip" data-a="${k}">${icon(ic, 18)} ${t(lab)}</button>`)}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn danger" data-amb>${icon('hospital', 20)} ${t('Dispatch partner ambulance')}</button>${c.ambulance && !c.ambulance.arrivedAt ? h`<button class="btn soft" data-a="arrived">${t('Ambulance arrived')}</button>` : ''}<button class="btn soft" data-a="hospital_reached">${t('Reached hospital')}</button></div>
        <form id="note" class="row" style="gap:8px;margin-top:12px"><input name="note" placeholder="${t('Add a note')}" style="flex:1"><button class="btn small soft">${t('Add')}</button></form></div>
      <div class="card"><h2>3. ${t('Close the case')}</h2><form id="cl"><select name="outcome">${['Hospitalised', 'Treated at home', 'False alarm', 'Safety issue resolved', 'Referred to police', 'Senior was fine (anxiety)'].map((o) => h`<option>${t(o)}</option>`)}</select>
        <textarea name="notes" rows="2" placeholder="${t('Notes for the family')}"></textarea><button class="btn block" style="margin-top:8px">${t('Close case and inform family')}</button></form></div>` : ''}
    ${closed ? h`<div class="card"><h2>${t('Closed')}</h2><p>${c.outcome}${c.closeNotes ? '. ' + c.closeNotes : ''}</p>${c.followUp ? h`<p class="muted">${t('Follow-up')}: ${c.followUp.notes} (${c.followUp.by})</p>` : h`<p class="badge amber">${t('Follow-up due')} ${fmtDateTime(c.followUpDueAt)}</p>`}</div>` : ''}`;
  let timer;
  return {
    title: 'SOS case', html,
    mount(el) {
      const post = async (path, body, msg) => { try { await api.post(`/cases/${c.id}/${path}`, body); if (msg) toast(msg); ctx.refresh(); } catch (e) { toast(e.message, true); } };
      el.querySelector('[data-ack]')?.addEventListener('click', () => post('ack', {}, t('Acknowledged. Family told you are handling it.')));
      el.querySelector('#tri')?.addEventListener('submit', (e) => { e.preventDefault(); const f = formData(e.target); const k = e.target.querySelector('select').selectedOptions[0].dataset.k; post('triage', { type: f.type || k, reason: f.reason }); });
      el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { const k = b.dataset.a; post('action', k === 'call_senior_na' ? { kind: 'call_senior', answered: false } : { kind: k }); });
      el.querySelector('[data-amb]')?.addEventListener('click', () => post('action', { kind: 'dispatch_ambulance', eta: 12 }, t('Ambulance dispatched. Family alerted with vehicle and ETA.')));
      el.querySelector('#note')?.addEventListener('submit', (e) => { e.preventDefault(); post('action', { kind: 'note', note: formData(e.target).note }); });
      el.querySelector('#cl')?.addEventListener('submit', async (e) => { e.preventDefault(); if (!(await confirmBox(t('Close this case?'), { ok: t('Close case') }))) return; post('close', formData(e.target), t('Closed. Follow-up scheduled in 24 hours.')); });
      if (!closed) timer = setInterval(() => { if (!location.hash.startsWith(`#/ops/case/${c.id}`)) return clearInterval(timer); if (!document.querySelector('.modal-bg') && !el.contains(document.activeElement)) ctx.refresh(); }, 10000);
    },
  };
}

// ---------- verification ----------
export async function verify(ctx) {
  const list = await api.get('/ops/verification');
  const opts = (k, v) => h`<select data-check="${k}" aria-label="${k}">${['pending', 'pass', 'fail'].map((o) => h`<option ${o === (v || 'pending') ? 'selected' : ''}>${o}</option>`)}</select>`;
  const html = h`<div class="page-head"><h1>${t('Verification queue')}</h1><p>${t('Nobody goes live until ID, police verification and interview pass, nurses are checked with the nursing council, and induction is 80% or more.')}</p></div>
    ${list.length ? list.map((c) => h`<div class="card" data-cg="${c.id}"><div class="row between"><div><h2 style="margin:0">${c.name}</h2><small class="muted">${t(c.categoryLabel)} · ${c.provider}${c.providerType === 'independent' ? ' (' + t('independent') + ')' : ''} · ${statusBadge2(c.status)}</small></div><span class="muted">${c.registrationExpiry && Date.parse(c.registrationExpiry) - ctx.now < 30 * 864e5 ? h`<span class="badge red">${t('registration expires')} ${fmtDate(Date.parse(c.registrationExpiry))}</span>` : ''}</span></div>
      <dl class="kv" style="margin-top:.5rem"><dt>${t('Registration')}</dt><dd>${c.registrationNo || '-'} ${c.registrationCouncil ? '· ' + c.registrationCouncil : ''}</dd><dt>PAN</dt><dd>${c.pan || '-'}</dd><dt>${t('Experience')}</dt><dd>${c.experienceYears ?? '-'} ${t('years')} · ${c.qualifications || ''}</dd><dt>${t('Induction')}</dt><dd>${c.inductionScore || 0}%</dd></dl>
      <div class="grid four">${[['id', 'Aadhaar e-KYC'], ['registration', 'Council registry'], ['police', 'Police'], ['references', 'References'], ['interview', 'Interview']].map(([k, l]) => h`<label>${t(l)} ${opts(k, c.verification?.[k])}</label>`)}</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn small soft" data-act="update">${t('Save checks')}</button>${c.status === 'submitted' ? h`<button class="btn small soft" data-act="review">${t('Start review')}</button>` : ''}<button class="btn small" data-act="approve">${t('Approve')}</button><button class="btn small ghost" data-act="reject">${t('Reject')}</button>${c.status === 'verified' ? h`<button class="btn small danger ghost" data-act="suspend">${t('Suspend')}</button>` : ''}</div>
      ${c.log?.length ? h`<details><summary class="muted">${t('History')}</summary>${c.log.map((x) => h`<div><small>${fmtDateTime(x.createdAt)} ${x.from} → ${x.to}: ${x.reason} (${x.by})</small></div>`)}</details>` : ''}
    </div>`) : empty(t('The queue is empty.'))}`;
  return {
    title: 'Verification', html,
    mount(el) {
      el.querySelectorAll('[data-cg]').forEach((card) => card.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
        const checks = Object.fromEntries([...card.querySelectorAll('[data-check]')].map((s) => [s.dataset.check, s.value]));
        let reason;
        if (['reject', 'suspend'].includes(b.dataset.act)) { reason = await askText(t('Reason (shown to the caregiver)')); if (!reason) return; }
        try { await api.post(`/ops/verification/${card.dataset.cg}`, { action: b.dataset.act, checks, reason }); toast(t('Saved')); ctx.refresh(); } catch (e) { toast(e.message, true); }
      }));
    },
  };
}
function statusBadge2(s) { const m = { submitted: ['Submitted', 'info'], under_review: ['Under review', 'amber'], verified: ['Verified', 'green'], expired: ['Expired', 'red'] }[s] || [s, '']; return h`<span class="badge ${m[1]}">${t(m[0])}</span>`; }

// ---------- check visits ----------
export async function checks(ctx) {
  const [list, nurses] = await Promise.all([api.get('/ops/checkvisits'), api.get('/ops/nurses')]);
  const ok = nurses.filter((n) => ['RN', 'GNM', 'ANM'].includes(n.category));
  const html = h`<div class="page-head"><h1>${t('Check visits')}</h1><p>${t('Assign a nurse to every subscriber check visit. Keep the same nurse where possible so the senior knows them.')}</p></div>
    <div class="card">${list.length ? list.map((b) => h`<div class="queue-row"><div><strong>${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)}</strong> · ${b.seniorName}<br><small class="muted">${b.preferred ? t('Last nurse') + ': ' + b.preferred : t('First visit')}</small> ${statusBadge(b.status)} ${b.caregiverName ? h`<strong>${b.caregiverName}</strong>` : ''}</div>
      <div class="row"><select data-sel="${b.id}">${ok.map((n) => h`<option value="${n.id}" ${n.id === (b.caregiverId || b.preferredCaregiverId) ? 'selected' : ''}>${n.name} (${n.category}, ${n.quality ?? t('new')})</option>`)}</select><button class="btn small" data-assign="${b.id}">${b.caregiverId ? t('Change') : t('Assign')}</button></div></div>`) : empty(t('All check visits are assigned.'))}</div>`;
  return {
    title: 'Check visits', html,
    mount(el) { el.querySelectorAll('[data-assign]').forEach((b) => b.onclick = async () => { try { await api.post(`/ops/checkvisits/${b.dataset.assign}/assign`, { caregiverId: el.querySelector(`[data-sel="${b.dataset.assign}"]`).value }); toast(t('Assigned')); ctx.refresh(); } catch (e) { toast(e.message, true); } }); },
  };
}

// ---------- quality desk ----------
export async function quality(ctx) {
  const [tickets, flags, held, supply, scams, nurses] = await Promise.all([api.get('/ops/tickets'), api.get('/ops/flags'), api.get('/ops/reviews/held'), api.get('/ops/supply'), api.get('/scam/reports'), api.get('/ops/nurses')]);
  const openT = tickets.filter((x) => x.status === 'open');
  const html = h`<div class="page-head"><h1>${t('Quality desk')}</h1><p>${t('Low ratings and no-shows open a ticket. Respond within 1 hour and offer a replacement under the backup guarantee.')}</p></div>
    <div class="card"><h2>${t('Quality tickets')} (${openT.length})</h2>${openT.length ? openT.map((x) => h`<div class="queue-row"><div><span class="badge ${x.priority === 'high' ? 'red' : 'amber'}">${t(x.kind.replace('_', ' '))}</span> <strong>${x.caregiverName || x.providerName || ''}</strong>${x.quality != null ? h` <small class="muted">${t('score')} ${x.quality}</small>` : ''}<br>${x.text}<br><small class="muted">${ago(x.createdAt, ctx.now)}${x.dueAt && x.dueAt < ctx.now ? ' · ' + t('overdue') : ''}</small></div>
      <div class="row">${x.bookingId ? h`<select data-rep="${x.id}" aria-label="${t('Replacement')}"><option value="">${t('No replacement')}</option>${nurses.slice(0, 20).map((n) => h`<option value="${n.id}">${n.name} (${n.category})</option>`)}</select>` : ''}<button class="btn small" data-ticket="${x.id}">${t('Resolve')}</button></div></div>`) : h`<p class="muted">${t('No open tickets.')}</p>`}</div>
    <div class="grid two">
      <div class="card"><h2>${t('Prices to review')}</h2>${flags.filter((l) => l.status === 'review').map((l) => h`<div class="queue-row"><div><strong>${l.provider}</strong> · ${l.service}<br><small>${money(l.minCharge)} ${t('vs median')} ${money(l.median)} <span class="badge amber">${t(l.flag === 'low' ? 'very low' : 'very high')}</span></small></div><div class="row"><button class="btn small soft" data-flag="${l.id}" data-a="approve">${t('Allow')}</button><button class="btn small ghost" data-flag="${l.id}" data-a="reject">${t('Reject')}</button></div></div>`) || ''}${flags.some((l) => l.status === 'review') ? '' : h`<p class="muted">${t('Nothing to review.')}</p>`}</div>
      <div class="card"><h2>${t('Reviews held for checking')}</h2>${held.length ? held.map((r) => h`<div class="queue-row"><div><span class="stars">${stars(Object.values(r.ratings)[0])}</span> ${r.text}<br><small class="muted">${(r.flags || []).join(', ')}</small></div><div class="row"><button class="btn small soft" data-rev="${r.id}" data-a="publish">${t('Publish')}</button><button class="btn small ghost" data-rev="${r.id}" data-a="remove">${t('Remove')}</button></div></div>`) : h`<p class="muted">${t('None held.')}</p>`}</div>
      <div class="card"><h2>${t('Requests with no provider')}</h2>${supply.filter((s) => s.status === 'open').length ? supply.filter((s) => s.status === 'open').map((s) => h`<div class="queue-row"><div><strong>${s.area}</strong> · ${s.serviceId?.replace('svc_', '')}<br><small class="muted">${ago(s.createdAt, ctx.now)}</small></div><button class="btn small soft" data-sup="${s.id}">${t('Sourcing')}</button></div>`) : h`<p class="muted">${t('None open.')}</p>`}</div>
      <div class="card"><h2>${t('Scam reports')}</h2>${scams.filter((s) => s.status !== 'advised').length ? scams.filter((s) => s.status !== 'advised').map((s) => h`<div class="queue-row"><div><strong>${s.seniorName}</strong> ${s.lostMoney ? h`<span class="badge red">${t('money lost')} ${money(s.amount)}</span>` : ''}<br>${s.text}</div><button class="btn small soft" data-scam="${s.id}">${t('Advised')}</button></div>`) : h`<p class="muted">${t('All handled.')}</p>`}</div>
    </div>`;
  return {
    title: 'Quality', html,
    mount(el) {
      const run = async (fn, msg) => { try { await fn(); toast(msg || t('Saved')); ctx.refresh(); } catch (e) { toast(e.message, true); } };
      el.querySelectorAll('[data-ticket]').forEach((b) => b.onclick = async () => { const rep = el.querySelector(`[data-rep="${b.dataset.ticket}"]`)?.value; const resolution = await askText(t('What did you do?'), { value: 'Called family and caregiver' }); if (!resolution) return; run(() => api.post(`/ops/tickets/${b.dataset.ticket}`, { resolution, replacementCaregiverId: rep || undefined }), rep ? t('Replacement booked at no extra cost') : t('Resolved')); });
      el.querySelectorAll('[data-flag]').forEach((b) => b.onclick = () => run(() => api.post(`/ops/flags/${b.dataset.flag}`, { action: b.dataset.a })));
      el.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => { let reason; if (b.dataset.a === 'remove') { reason = await askText(t('Reason: abuse, personal data or proven fraud'), { value: 'abuse' }); if (!reason) return; } run(() => api.post(`/ops/reviews/${b.dataset.rev}`, { action: b.dataset.a, reason: reason?.toLowerCase() })); });
      el.querySelectorAll('[data-sup]').forEach((b) => b.onclick = () => run(() => api.post(`/ops/supply/${b.dataset.sup}`, { status: 'sourcing' })));
      el.querySelectorAll('[data-scam]').forEach((b) => b.onclick = () => run(() => api.post(`/ops/scam/${b.dataset.scam}`, { advice: 'Called family; 1930 complaint guided' })));
    },
  };
}

// ---------- grievances ----------
function grievanceRows(list, ctx) {
  return list.length ? h`${list.map((g) => h`<div class="queue-row"><div>${g.priority === 'P0' ? h`<span class="badge red">P0</span> ` : ''}<strong>${g.subject || g.category}</strong> <span class="badge ${g.status === 'resolved' ? 'green' : g.ackAt ? 'info' : 'amber'}">${t(g.status === 'resolved' ? 'Resolved' : g.ackAt ? 'Acknowledged' : 'New')}</span>${g.ackOverdue ? h` <span class="badge red">${t('ack overdue')}</span>` : ''}${g.resolveOverdue ? h` <span class="badge red">${t('resolution overdue')}</span>` : ''}<br>${g.text}<br><small class="muted">${g.userName} · ${ago(g.createdAt, ctx.now)} · ${t('resolve by')} ${fmtDate(g.resolveDueAt)}</small></div>
    ${g.status !== 'resolved' ? h`<div class="row">${!g.ackAt ? h`<button class="btn small soft" data-g="${g.id}" data-a="ack">${t('Acknowledge')}</button>` : ''}<button class="btn small" data-g="${g.id}" data-a="resolve">${t('Resolve')}</button></div>` : h`<small>${g.outcome}</small>`}</div>`)}` : h`<p class="muted">${t('No complaints.')}</p>`;
}
export async function grievances(ctx) {
  const list = await api.get('/grievances');
  const open = list.filter((g) => g.status !== 'resolved');
  const html = h`<div class="page-head"><h1>${t('Complaints')}</h1><p>${t('Acknowledge within 48 hours (1 hour for safety), resolve within 30 days.')}</p></div>
    <div class="card"><h2>${t('Open')} (${open.length})</h2>${grievanceRows(open, ctx)}</div>
    <div class="card"><h2>${t('Resolved')}</h2>${grievanceRows(list.filter((g) => g.status === 'resolved').slice(0, 15), ctx)}</div>`;
  return {
    title: 'Complaints', html,
    mount(el) { bindGrievances(el, ctx); },
  };
}

function bindGrievances(el, ctx) {
      el.querySelectorAll('[data-g]').forEach((b) => b.onclick = async () => {
        const id = b.dataset.g;
        if (b.dataset.a === 'ack') { await api.post(`/ops/grievances/${id}`, { action: 'ack' }); return ctx.refresh(); }
        modal(h`<h2>${t('Resolve complaint')}</h2><form id="f"><label>${t('Outcome')}</label><select name="outcome">${['Apology', 'Credit', 'Refund', 'Re-training', 'Suspension', 'No fault found'].map((o) => h`<option>${o}</option>`)}</select>
          <label>${t('Credit amount (if credit)')}</label><input name="amount" inputmode="numeric" value="300"><label class="check"><input type="checkbox" name="substantiated"> ${t('Complaint was substantiated (affects quality score)')}</label>
          <label>${t('Note to the family')}</label><textarea name="note" rows="3"></textarea><button class="btn block" style="margin-top:12px">${t('Resolve')}</button></form>`, (m, close) => {
          m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); try { await api.post(`/ops/grievances/${id}`, { action: 'resolve', ...formData(e.target) }); close(); toast(t('Resolved. Family informed.')); ctx.refresh(); } catch (err) { toast(err.message, true); } };
        });
      });
    }
