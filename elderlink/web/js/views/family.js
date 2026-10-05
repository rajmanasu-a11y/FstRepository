// Family app: dashboard (FR-DSH), search and compare (FR-SRC), booking (FR-BKG), reviews (FR-REV)
// and the extended services (equipment, programs, events, schemes, vault, scam shield, safety).
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, formData, fmtTime, fmtDay, fmtDate, fmtDateTime, money, stars, initials, statusBadge, bandBadge, empty, ago } from '../ui.js';

export function pickSenior(ctx, seniors) {
  let id = ctx.query.senior || ctx.state.seniorId;
  if (!id) { try { id = localStorage.getItem('elderlink.senior'); } catch { /* ignore */ } }
  const s = seniors.find((x) => x.id === id) || seniors[0];
  if (s) { ctx.state.seniorId = s.id; try { localStorage.setItem('elderlink.senior', s.id); } catch { /* ignore */ } }
  return s;
}
export function seniorChips(seniors, sel) {
  if (seniors.length < 2) return '';
  return h`<div class="chips" role="group" aria-label="${t('Choose senior')}" style="margin-bottom:12px">${seniors.map((s) => h`<button class="chip ${s.id === sel?.id ? 'on' : ''}" data-senior="${s.id}">${icon('user', 18)} ${s.name.split(' ')[0]}</button>`)}</div>`;
}
export function bindSeniorChips(el, ctx) {
  el.querySelectorAll('[data-senior]').forEach((b) => b.onclick = () => { ctx.state.seniorId = b.dataset.senior; try { localStorage.setItem('elderlink.senior', b.dataset.senior); } catch { /* ignore */ } ctx.refresh(); });
}
const back = (href, label = 'Back') => h`<a class="back" href="${href}">${icon('back')} ${t(label)}</a>`;

function alertLink(a, sid) {
  return { approval: `#/booking/${a.id}`, confirm: `#/booking/${a.id}`, late: `#/booking/${a.id}`, dose: `#/meds/${sid}`, sos: `#/case/${a.id}`, vitals: `#/vitals/${sid}`, checkin: `#/safety/${sid}`, billing: `#/plans/${sid}` }[a.kind] || '#/home';
}

export async function home(ctx) {
  const d = await api.get('/family/home');
  const u = ctx.user;
  const local = u.tz && u.tz !== 'Asia/Kolkata' ? h` · ${u.city || u.tz.split('/')[1]} ${fmtTime(ctx.now, u.tz)}` : '';
  const card = (x) => {
    const s = x.senior;
    const lv = x.lastVitals;
    return h`<section class="card" aria-labelledby="sen-${s.id}">
      <div class="row between top">
        <div class="row"><span class="avatar">${initials(s.name)}</span><div><h2 id="sen-${s.id}" style="margin:0">${s.name}, ${s.age}</h2><small class="muted">${s.area || s.city} · ${(s.conditions || []).slice(0, 2).join(', ')}</small></div></div>
        ${x.subscription ? h`<span class="badge brand">${icon('shield', 14)} ${x.subscription.plan} ${t('plan')}</span>` : h`<a class="badge amber" href="#/plans/${s.id}">${t('No plan')}</a>`}
      </div>
      ${x.alerts.length ? h`<div style="margin-top:12px">${x.alerts.map((a) => h`<div class="alert ${a.level === 'info' ? '' : a.level}">${icon(a.level === 'red' ? 'alert' : 'info', 22)}<span>${t(a.text)}</span><a class="btn small ${a.level === 'red' ? 'danger' : 'soft'}" href="${alertLink(a, s.id)}">${t(a.kind === 'approval' ? 'Review' : a.kind === 'confirm' ? 'Confirm' : 'Open')}</a></div>`)}</div>` : h`<div class="alert green" style="margin-top:12px">${icon('check', 22)} ${t('All good today')}</div>`}
      <div class="grid two" style="margin-top:8px">
        <div class="stat"><div class="l">${t("Today's visits")}</div>${x.visitsToday.length ? x.visitsToday.map((v) => h`<div style="margin-top:4px"><a href="#/booking/${v.id}"><strong>${fmtTime(v.start)}</strong> ${v.serviceName.split('(')[0]}</a><br>${v.caregiverName || v.providerName} ${statusBadge(v.status)}</div>`) : h`<div class="n" style="font-size:1.1rem">${t('None')}</div>`}</div>
        <div class="stat"><div class="l">${t('Medicines today')}</div><div class="n">${x.doses.taken}/${x.doses.total}</div><div>${x.doses.missed ? h`<span class="badge red">${x.doses.missed} ${t('missed')}</span>` : ''} <span class="muted">${t('7-day adherence')}: ${x.doses.adherence7 ?? '-'}%</span></div></div>
        <a class="stat" href="#/vitals/${s.id}" style="text-decoration:none;color:inherit"><div class="l">${t('Last vitals')}</div>${lv ? h`<div class="row"><span class="light ${lv.status.overall}"></span><strong>BP ${lv.bpSys ?? '-'}/${lv.bpDia ?? '-'}</strong> ${lv.sugar ? h`· ${t('Sugar')} ${lv.sugar}` : ''} ${lv.spo2 ? h`· SpO2 ${lv.spo2}%` : ''}</div><small class="muted">${ago(lv.at, ctx.now)} · ${lv.by}</small>` : h`<div>${t('No readings yet')}</div>`}</a>
        <div class="stat"><div class="l">${t('Next check visit')}</div>${x.nextCheck ? h`<div><strong>${fmtDay(x.nextCheck.start, ctx.now)}</strong> ${fmtTime(x.nextCheck.start)}</div><small>${x.nextCheck.caregiverName || t('Nurse being assigned')}</small>` : x.subscription ? h`<div>${t('Being scheduled')}</div>` : h`<a href="#/plans/${s.id}">${t('Included in family plans')}</a>`}</div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <a class="btn" href="#/find?senior=${s.id}">${icon('search', 20)} ${t('Book care')}</a>
        <a class="btn soft" href="#/meds/${s.id}">${icon('pill', 20)} ${t('Medicines')}</a>
        <a class="btn soft" href="#/senior-profile/${s.id}">${icon('user', 20)} ${t('Profile')}</a>
        <button class="btn danger ghost" data-sos="${s.id}">${icon('siren', 20)} ${t('SOS for')} ${s.name.split(' ')[0]}</button>
      </div>
    </section>`;
  };
  const html = h`
    <div class="page-head"><h1>${t('Hello')}, ${u.name.split(' ')[0]}</h1><p>${t('Bengaluru')} ${fmtTime(ctx.now)}${local}</p></div>
    ${d.seniors.length ? d.seniors.map(card) : empty(t('Add your parent to get started.'), h`<a class="btn" href="#/add-senior">${t('Add a senior')}</a>`)}
    <div class="grid two">
      <div class="card flat"><div class="row between"><div><div class="muted">${t('Spent in the last 30 days')}</div><div class="price">${money(d.spend30)}</div></div><a class="btn soft small" href="#/wallet">${t('Payments')}</a></div>${d.credit ? h`<small class="muted">${t('ElderLink credit')}: ${money(d.credit)}</small>` : ''}</div>
      <div class="card flat"><div class="row between"><div><strong>${t('Another parent or relative?')}</strong><br><small class="muted">${t('Manage everyone from one account')}</small></div><a class="btn ghost small" href="#/add-senior">${icon('plus', 18)} ${t('Add')}</a></div></div>
    </div>`;
  return {
    title: 'Home', html,
    mount(el) {
      el.querySelectorAll('[data-sos]').forEach((b) => b.onclick = async () => {
        if (!(await confirmBox(t('Raise an SOS for this senior? The 24x7 desk will call them and alert the family.'), { ok: t('Yes, raise SOS'), danger: true }))) return;
        try { const c = await api.post('/sos', { seniorId: b.dataset.sos, offline: ctx.state.offline }); ctx.go(`#/case/${c.id}`); } catch (e) { toast(e.message, true); }
      });
    },
  };
}

export async function seniorProfile(ctx) {
  const s = await api.get(`/seniors/${ctx.params.id}`);
  const canEdit = ['owner', 'manager', 'staff'].includes(s.myRole);
  const html = h`${back('#/home')}
    <div class="row between"><h1>${s.name}</h1>${canEdit ? h`<button class="btn soft small" data-edit>${icon('settings', 18)} ${t('Edit')}</button>` : ''}</div>
    ${s.consent?.status !== 'given' ? h`<div class="alert amber">${icon('alert')}<div><strong>${t('Consent needed')}</strong><br>${s.consent?.status === 'guardian_review' ? t('Guardian document is with our coordinator for approval.') : s.cognition === 'Dementia' || s.consent?.status === 'guardian_needed' ? t('Upload a guardianship or power-of-attorney document.') : t('We sent an SMS code to the senior. Enter it here, or we can record consent on a phone call.')}</div><button class="btn small" data-consent>${t('Record consent')}</button></div>` : ''}
    <div class="grid two">
      <div class="card"><h2>${t('About')}</h2><dl class="kv">
        <dt>${t('Age')}</dt><dd>${s.age} (${s.gender === 'F' ? t('Female') : s.gender === 'M' ? t('Male') : '-'})</dd>
        <dt>${t('Address')}</dt><dd>${s.address}</dd>
        <dt>${t('Languages')}</dt><dd>${(s.languages || []).join(', ')}</dd>
        <dt>${t('Mobile')}</dt><dd>${s.mobile || '-'} ${s.hasApp ? h`<span class="badge green">${t('uses the app')}</span>` : h`<span class="badge">${t('IVR / calls')}</span>`}</dd>
        <dt>ABHA</dt><dd>${s.abha || '-'}</dd></dl></div>
      <div class="card"><h2>${t('Health')}</h2><dl class="kv">
        <dt>${t('Conditions')}</dt><dd>${(s.conditions || []).join(', ') || '-'}</dd>
        <dt>${t('Allergies')}</dt><dd>${(s.allergies || []).join(', ') || t('None known')}</dd>
        <dt>${t('Mobility')}</dt><dd>${s.mobility}</dd><dt>${t('Memory')}</dt><dd>${s.cognition}</dd>
        <dt>${t('Blood group')}</dt><dd>${s.bloodGroup || '-'}</dd><dt>${t('Doctor')}</dt><dd>${s.doctor || '-'}</dd><dt>${t('Hospital')}</dt><dd>${s.hospital || '-'}</dd></dl></div>
    </div>
    <div class="card"><h2>${t('Emergency contacts nearby')}</h2>${(s.emergencyContacts || []).map((c) => h`<div class="row between" style="padding:.4rem 0"><span><strong>${c.name}</strong> · ${c.phone}</span><span class="muted">${c.distanceKm ?? '?'} km</span></div>`)}${(s.emergencyContacts || []).length < 2 ? h`<p class="alert amber">${t('Add two contacts who live within 20 km.')}</p>` : ''}</div>
    <div class="grid three">
      <a class="card" href="#/circle/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('users')} ${t('Care circle')}</h3><p class="muted">${s.circle?.length || 0} ${t('members')}</p></a>
      <a class="card" href="#/careplan/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('clipboard')} ${t('Care plan')}</h3><p class="muted">${t('Goals, routines, do-not-do list')}</p></a>
      <a class="card" href="#/plans/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('shield')} ${t('Family plan')}</h3><p class="muted">${s.subscription ? s.subscription.plan : t('Not subscribed')}</p></a>
      <a class="card" href="#/vitals/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('chart')} ${t('Vitals and reports')}</h3><p class="muted">${t('Trends over 30, 90, 365 days')}</p></a>
      <a class="card" href="#/safety/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('siren')} ${t('Safety')}</h3><p class="muted">${t('Daily check-in, SOS test')}</p></a>
      <a class="card" href="#/vault/${s.id}" style="text-decoration:none;color:inherit"><h3>${icon('lock')} ${t('Document vault')}</h3><p class="muted">${t('ID, insurance, pension papers')}</p></a>
    </div>
    <div class="card"><h2>${t('Timeline')}</h2><div id="tl"><p class="muted">${t('Loading...')}</p></div></div>`;
  return {
    title: s.name, html,
    async mount(el) {
      const tl = await api.get(`/seniors/${s.id}/timeline`);
      el.querySelector('#tl').innerHTML = h`<div class="chips" style="margin-bottom:8px">${['all', 'visit', 'report', 'dose', 'sos', 'payment'].map((k) => h`<button class="chip ${k === 'all' ? 'on' : ''}" data-f="${k}">${t({ all: 'All', visit: 'Visits', report: 'Reports', dose: 'Doses', sos: 'SOS', payment: 'Payments' }[k])}</button>`)}</div><ul class="timeline" id="tll">${tlItems(tl.filter((x) => x.at <= ctx.now).slice(0, 40), ctx)}</ul>`.s;
      el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); const f = b.dataset.f; el.querySelector('#tll').innerHTML = tlItems(tl.filter((x) => x.at <= ctx.now && (f === 'all' || x.type === f)).slice(0, 40), ctx).s; });
      el.querySelector('[data-edit]')?.addEventListener('click', () => editSenior(s, ctx));
      el.querySelector('[data-consent]')?.addEventListener('click', () => consentDialog(s, ctx));
    },
  };
}
function tlItems(items, ctx) {
  const link = (x) => ({ visit: `#/booking/${x.id}`, sos: `#/case/${x.id}`, dose: `#/meds/${ctx.params.id}`, report: `#/vitals/${ctx.params.id}` }[x.type] || null);
  return h`${items.map((x) => h`<li class="${['missed', 'red'].includes(x.status) ? 'red' : ''}"><time>${fmtDateTime(x.at)}</time>${link(x) ? h`<a href="${link(x)}"><strong>${x.title}</strong></a>` : h`<strong>${x.title}</strong>`} ${x.sub ? h`<span class="muted">· ${x.sub}</span>` : ''}</li>`)}`;
}

function editSenior(s, ctx) {
  modal(h`<h2>${t('Edit profile')}</h2><form id="f">
    <label>${t('Address')}</label><input name="address" value="${s.address}">
    <label>${t('Conditions')} <span class="hint">${t('comma separated')}</span></label><input name="conditions" value="${(s.conditions || []).join(', ')}">
    <label>${t('Allergies')}</label><input name="allergies" value="${(s.allergies || []).join(', ')}">
    <label>${t('Mobility')}</label><select name="mobility">${['Independent', 'Walks with a stick', 'Needs help to walk', 'Wheelchair', 'Bed-bound'].map((m) => h`<option ${m === s.mobility ? 'selected' : ''}>${m}</option>`)}</select>
    <label>${t('Doctor')}</label><input name="doctor" value="${s.doctor || ''}">
    <label>${t('Emergency contact 1')}</label><div class="grid two"><input name="ec1n" value="${s.emergencyContacts?.[0]?.name || ''}" placeholder="${t('Name')}"><input name="ec1p" value="${s.emergencyContacts?.[0]?.phone || ''}" placeholder="${t('Phone')}"></div>
    <label>${t('Emergency contact 2')}</label><div class="grid two"><input name="ec2n" value="${s.emergencyContacts?.[1]?.name || ''}" placeholder="${t('Name')}"><input name="ec2p" value="${s.emergencyContacts?.[1]?.phone || ''}" placeholder="${t('Phone')}"></div>
    <button class="btn block" style="margin-top:14px">${t('Save')}</button></form>`, (m, close) => {
    m.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const split = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
      const ec = [[f.ec1n, f.ec1p], [f.ec2n, f.ec2p]].filter(([n, p]) => n && p).map(([name, phone], i) => ({ name, phone, distanceKm: s.emergencyContacts?.[i]?.distanceKm ?? 5 }));
      try { await api.patch(`/seniors/${s.id}`, { address: f.address, conditions: split(f.conditions), allergies: split(f.allergies), mobility: f.mobility, doctor: f.doctor, emergencyContacts: ec }); close(); toast(t('Saved')); ctx.refresh(); } catch (err) { toast(err.message, true); }
    };
  });
}

function consentDialog(s, ctx) {
  modal(h`<h2>${t('Record consent')}</h2><p>${t('Under the DPDP Act the senior must agree, or a lawful guardian if they cannot decide.')}</p>
    <label>${t('Code from the SMS sent to the senior')} <span class="hint">(${t('demo code')}: 4321)</span></label><input id="code" inputmode="numeric"><button class="btn block" data-otp style="margin-top:8px">${t('Confirm with code')}</button>
    <hr><button class="btn soft block" data-ivr>${t('Record on a phone call instead')}</button>
    <hr><label>${t('Or upload guardian / power-of-attorney document')}</label><input type="file" id="doc"><button class="btn ghost block" data-guardian style="margin-top:8px">${t('Send for coordinator approval')}</button>`, (m, close) => {
    const done = () => { close(); toast(t('Saved')); ctx.refresh(); };
    m.querySelector('[data-otp]').onclick = async () => { try { await api.post(`/seniors/${s.id}/consent`, { method: 'otp', code: m.querySelector('#code').value }); done(); } catch (e) { toast(e.message, true); } };
    m.querySelector('[data-ivr]').onclick = async () => { await api.post(`/seniors/${s.id}/consent`, { method: 'ivr' }); done(); };
    m.querySelector('[data-guardian]').onclick = async () => { const f = m.querySelector('#doc').files[0]; try { await api.post(`/seniors/${s.id}/consent`, { method: 'guardian', document: f?.name }); done(); } catch (e) { toast(e.message, true); } };
  });
}

export async function addSenior(ctx) {
  const html = h`${back('#/home')}<h1>${t('Add a senior')}</h1><p class="muted">${t('Takes about two minutes. You can add health details later.')}</p>
    <form id="f" class="card">
      <label for="n">${t('Full name')}</label><input id="n" name="name" required>
      <div class="grid two"><div><label for="dob">${t('Date of birth')}</label><input id="dob" name="dob" type="date" required></div>
      <div><label for="g">${t('Gender')}</label><select id="g" name="gender"><option value="F">${t('Female')}</option><option value="M">${t('Male')}</option><option value="O">${t('Other')}</option></select></div></div>
      <label for="rel">${t('You are their')}</label><select id="rel" name="relation"><option>son</option><option>daughter</option><option>grandchild</option><option>relative</option><option>friend</option></select>
      <label for="a">${t('Home address')}</label><textarea id="a" name="address" required placeholder="House, street, area, city, PIN"></textarea>
      <label for="ar">${t('Area')}</label><select id="ar" name="area">${[['Jayanagar', 12.925, 77.5838], ['JP Nagar', 12.9077, 77.5851], ['Basavanagudi', 12.9406, 77.5738], ['Koramangala', 12.9352, 77.6245], ['BTM Layout', 12.9166, 77.6101], ['Whitefield', 12.9698, 77.75]].map(([n, la, ln]) => h`<option value="${n}|${la}|${ln}">${n}, Bengaluru</option>`)}</select>
      <label for="m">${t('Senior\'s mobile')} <span class="hint">${t('optional; landline or feature phone is fine')}</span></label><input id="m" name="mobile" inputmode="tel">
      <label for="c">${t('Health conditions')} <span class="hint">${t('comma separated')}</span></label><input id="c" name="conditions" placeholder="Diabetes, BP">
      <label for="cog">${t('Memory')}</label><select id="cog" name="cognition"><option>Normal</option><option>Mild memory issues</option><option value="Dementia">${t('Dementia (needs a guardian to consent)')}</option></select>
      <button class="btn block" style="margin-top:16px">${t('Save')}</button>
    </form>`;
  return {
    title: 'Add a senior', html,
    mount(el) {
      el.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const [area, lat, lng] = f.area.split('|');
        try {
          const s = await api.post('/seniors', { ...f, area, lat: Number(lat), lng: Number(lng), conditions: f.conditions.split(',').map((x) => x.trim()).filter(Boolean) });
          toast(t('Added. We sent a consent SMS to the senior.'));
          ctx.go(`#/senior-profile/${s.id}`);
        } catch (err) { toast(err.message, true); }
      };
    },
  };
}

// ---------------- search ----------------
const CATS = [['care', 'Health care'], ['package', 'Packages'], ['daily', 'Daily living'], ['social', 'Company']];

export async function find(ctx) {
  const [seniors, services] = await Promise.all([api.get('/seniors'), api.get('/services')]);
  const sel = pickSenior(ctx, seniors);
  const q = ctx.query;
  const cat = q.cat || 'care';
  const svcId = q.serviceId || services.find((s) => s.category === cat)?.id;
  const res = sel ? await api.get('/search', { seniorId: sel.id, serviceId: svcId, sort: q.sort, maxPrice: q.maxPrice, gender: q.gender, language: q.language, providerType: q.providerType, minRating: q.minRating, date: q.date }) : { results: [] };
  const params = (over) => '#/find?' + new URLSearchParams({ ...q, senior: sel?.id || '', ...over }).toString();
  const cmp = ctx.state.compare;
  const html = h`
    <div class="page-head"><h1>${t('Find care')}</h1><p>${sel ? h`${t('Verified providers who cover')} ${sel.name.split(' ')[0]}'s ${t('home in')} ${sel.area}` : ''}</p></div>
    ${seniorChips(seniors, sel)}
    <div class="chips" style="margin-bottom:10px">${CATS.map(([k, l]) => h`<a class="chip ${k === cat ? 'on' : ''}" href="${params({ cat: k, serviceId: '' })}">${t(l)}</a>`)}</div>
    <label for="svc" class="sr-only">${t('Service')}</label>
    <select id="svc">${services.filter((s) => s.category === cat).map((s) => h`<option value="${s.id}" ${s.id === svcId ? 'selected' : ''}>${tf(s)}</option>`)}</select>
    <details class="card flat" style="margin-top:10px" ${q.maxPrice || q.gender || q.language || q.providerType || q.minRating || q.date ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;min-height:32px">${icon('settings', 18)} ${t('Filters and sort')}</summary>
      <form id="flt" class="grid two" style="margin-top:8px">
        <div><label>${t('Sort by')}</label><select name="sort">${[['recommended', 'Recommended'], ['price', 'Lowest price'], ['nearest', 'Nearest'], ['rating', 'Highest rated'], ['reviews', 'Most reviewed']].map(([v, l]) => h`<option value="${v}" ${q.sort === v ? 'selected' : ''}>${t(l)}</option>`)}</select></div>
        <div><label>${t('Maximum price')} (₹)</label><input name="maxPrice" type="number" inputmode="numeric" value="${q.maxPrice || ''}"></div>
        <div><label>${t('Caregiver gender')}</label><select name="gender"><option value="">${t('Any')}</option><option value="F" ${q.gender === 'F' ? 'selected' : ''}>${t('Female')}</option><option value="M" ${q.gender === 'M' ? 'selected' : ''}>${t('Male')}</option></select></div>
        <div><label>${t('Language')}</label><select name="language"><option value="">${t('Any')}</option>${['Kannada', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'English'].map((l) => h`<option ${q.language === l ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div><label>${t('Provider type')}</label><select name="providerType"><option value="">${t('Any')}</option>${[['hospital', 'Hospital'], ['agency', 'Agency'], ['nursing_home', 'Nursing home'], ['independent', 'Independent']].map(([v, l]) => h`<option value="${v}" ${q.providerType === v ? 'selected' : ''}>${t(l)}</option>`)}</select></div>
        <div><label>${t('Minimum quality score')}</label><select name="minRating"><option value="">${t('Any')}</option>${[60, 70, 85].map((v) => h`<option value="${v}" ${q.minRating == v ? 'selected' : ''}>${v}+</option>`)}</select></div>
        <div><label>${t('Available on')}</label><input type="date" name="date" value="${q.date || ''}"></div>
        <div style="align-self:end"><button class="btn block">${t('Apply')}</button></div>
      </form></details>
    ${res.median ? h`<div class="alert">${icon('info', 22)}<span>${t('City median price')}: <strong>${money(res.median)}</strong> ${t('per')} ${t(res.service.unit)}. ${t('All prices are minimum charges; you see the full price before paying.')}</span></div>` : ''}
    ${res.noCoverage ? h`<div class="card"><h2>${t('No verified provider covers this address yet')}</h2><p>${t('We have told our coordinators. They will find someone and call you.')}</p></div>` : ''}
    <div id="results">${res.results.map((r) => listingCard(r, cmp))}</div>
    ${cmp.length ? h`<div class="compare-bar"><div class="inner"><span>${cmp.length} ${t('selected')}</span><span style="flex:1"></span><button class="btn small ghost" data-clear style="color:inherit;border-color:currentColor">${t('Clear')}</button><a class="btn small" href="#/compare">${t('Compare')}</a></div></div>` : ''}`;
  return {
    title: 'Find care', html,
    mount(el) {
      bindSeniorChips(el, ctx);
      el.querySelector('#svc').onchange = (e) => ctx.go(params({ serviceId: e.target.value }));
      el.querySelector('#flt').onsubmit = (e) => { e.preventDefault(); ctx.go(params(formData(e.target))); };
      el.querySelectorAll('[data-cmp]').forEach((c) => c.onchange = () => {
        const id = c.dataset.cmp;
        const i = cmp.findIndex((x) => x.id === id);
        if (c.checked) { if (cmp.length >= 3) { c.checked = false; toast(t('You can compare up to three')); return; } cmp.push(res.results.find((x) => x.id === id)); } else if (i >= 0) cmp.splice(i, 1);
        ctx.refresh();
      });
      el.querySelector('[data-clear]')?.addEventListener('click', () => { cmp.length = 0; ctx.refresh(); });
    },
  };
}

export function listingCard(r, cmp = []) {
  const p = r.provider;
  const diff = r.medianPrice ? Math.round(((r.minCharge - r.medianPrice) / r.medianPrice) * 100) : 0;
  return h`<article class="card">
    ${r.sponsored ? h`<span class="badge" style="margin-bottom:6px">${t('Sponsored')}</span>` : ''}
    <div class="lcard">
      <span class="avatar">${p.type === 'independent' ? initials(p.name) : icon('hospital', 24)}</span>
      <div class="info">
        <a class="name" href="#/listing/${r.id}">${p.name}</a> ${p.trusted ? h`<span class="badge green">${icon('star', 13)} ${t('ElderLink Trusted')}</span>` : ''}
        <div class="meta">${t(p.categoryLabel || p.type)} · ${r.distanceKm} km · ${(r.languages || []).slice(0, 3).join(', ')}</div>
        <div class="row" style="margin:6px 0">${bandBadge(p.band, p.quality)} <span class="muted">${p.reviewCount} ${t('verified reviews')}</span></div>
        <div class="chips">${p.badges.slice(0, 4).map((b) => h`<span class="badge green">${icon('check', 12)} ${t(b)}</span>`)}</div>
        <div class="meta" style="margin-top:6px">${t('Next free')}: ${r.nextSlot ? fmtDateTime(r.nextSlot) : t('fully booked this week')}</div>
      </div>
      <div class="right"><div class="price">${money(r.minCharge)}</div><small class="muted">${t('per')} ${t(r.unit)}</small><br>${diff <= -10 ? h`<span class="badge green">${-diff}% ${t('below median')}</span>` : diff >= 15 ? h`<span class="badge">${diff}% ${t('above median')}</span>` : ''}</div>
    </div>
    <div class="row between" style="margin-top:10px"><label class="check" style="font-size:.95rem"><input type="checkbox" data-cmp="${r.id}" ${cmp.some((x) => x.id === r.id) ? 'checked' : ''}> ${t('Compare')}</label><div class="btn-row"><a class="btn ghost small" href="#/listing/${r.id}">${t('Details')}</a><a class="btn small" href="#/book/${r.id}">${t('Book')}</a></div></div>
  </article>`;
}

export async function compare(ctx) {
  const rows = ctx.state.compare;
  if (!rows.length) return { html: h`${back('#/find')}${empty(t('Pick up to three providers to compare from Find care.'))}` };
  const line = (label, f) => h`<tr><th>${t(label)}</th>${rows.map((r) => h`<td>${f(r)}</td>`)}</tr>`;
  const html = h`${back('#/find')}<h1>${t('Compare')}</h1><div class="card table-wrap"><table>
    <tr><th></th>${rows.map((r) => h`<th style="color:var(--ink);font-size:1rem">${r.provider.name}</th>`)}</tr>
    ${line('Minimum charge', (r) => h`<strong>${money(r.minCharge)}</strong> / ${t(r.unit)}`)}
    ${line('Quality', (r) => bandBadge(r.provider.band, r.provider.quality))}
    ${line('Verified reviews', (r) => r.provider.reviewCount)}
    ${line('Distance', (r) => `${r.distanceKm} km`)}
    ${line('Type', (r) => t(r.provider.categoryLabel || r.provider.type))}
    ${line('Languages', (r) => (r.languages || []).join(', '))}
    ${line('Checks', (r) => r.provider.badges.join(', '))}
    ${line('Next free slot', (r) => (r.nextSlot ? fmtDateTime(r.nextSlot) : '-'))}
    ${line('Add-ons', (r) => r.addOns.map((a) => `${a.name} (${money(a.price)})`).join(', ') || '-')}
    <tr><th></th>${rows.map((r) => h`<td><a class="btn small block" href="#/book/${r.id}">${t('Book')}</a></td>`)}</tr>
  </table></div>`;
  return { title: 'Compare', html };
}

export async function listing(ctx) {
  const seniors = await api.get('/seniors');
  const sel = pickSenior(ctx, seniors);
  const l = await api.get(`/listings/${ctx.params.id}`, { seniorId: sel?.id });
  const p = await api.get(`/providers/${l.provider.id}`, { seniorId: sel?.id });
  const html = h`${back('#/find')}
    <div class="card"><div class="lcard"><span class="avatar lg">${p.type === 'independent' ? initials(p.name) : icon('hospital', 32)}</span><div class="info">
      <h1 style="margin:0">${p.name}</h1><div class="meta">${t(p.categoryLabel || p.type)} · ${p.area} · ${l.distanceKm} km</div>
      <div class="row" style="margin:8px 0">${bandBadge(p.band, p.quality)} ${p.trusted ? h`<span class="badge green">${icon('star', 13)} ${t('ElderLink Trusted')}</span>` : ''} <a href="#/provider/${p.id}">${p.reviewCount} ${t('verified reviews')}</a></div>
    </div></div>
      <h2 style="margin-top:12px">${l.title || tf(l, 'serviceName')}</h2>
      <p><span class="price">${money(l.minCharge)}</span> <span class="muted">${t('minimum charge per')} ${t(l.unit)} · ${t('city median')} ${money(l.medianPrice)}</span></p>
      ${l.packageItems ? h`<ul>${l.packageItems.map((x) => h`<li>${x}</li>`)}</ul>` : ''}
      ${l.addOns.length ? h`<p><strong>${t('Optional add-ons')}:</strong> ${l.addOns.map((a) => `${a.name} (${money(a.price)})`).join(', ')}</p>` : ''}
      <a class="btn block" href="#/book/${l.id}">${t('Choose a time and book')}</a>
    </div>
    ${providerBody(p)}`;
  return { title: p.name, html };
}

function providerBody(p) {
  const dims = { punctuality: 'Punctuality', skill: 'Skill', behaviour: 'Behaviour and respect', hygiene: 'Hygiene', communication: 'Communication' };
  return h`
    <div class="grid two">
      <div class="card"><h2>${t('About')}</h2><p>${p.bio || ''}</p><dl class="kv">
        ${p.qualifications ? h`<dt>${t('Qualifications')}</dt><dd>${p.qualifications}</dd>` : ''}
        ${p.experienceYears ? h`<dt>${t('Experience')}</dt><dd>${p.experienceYears} ${t('years')}</dd>` : ''}
        ${p.registration ? h`<dt>${t('Registration')}</dt><dd>${p.registration}</dd>` : ''}
        <dt>${t('Address')}</dt><dd>${p.address || p.area}</dd>
        <dt>${t('Languages')}</dt><dd>${(p.languages || []).join(', ')}</dd></dl></div>
      <div class="card"><h2>${t('Verification')}</h2>${p.badges.map((b) => h`<div class="row" style="padding:.25rem 0">${icon('check2', 20)} ${t(b)}</div>`)}<small class="muted">${t('Last checked')}: ${p.lastChecked ? fmtDate(p.lastChecked) : '-'}</small>
        ${p.staff?.length ? h`<h3 style="margin-top:12px">${t('Verified staff')}</h3>${p.staff.map((s) => h`<div class="row" style="padding:.25rem 0"><span class="avatar" style="width:34px;height:34px;font-size:.8rem">${initials(s.name)}</span>${s.name} <small class="muted">${s.category}</small></div>`)}` : ''}</div>
    </div>
    <div class="card"><h2>${t('What families say')}</h2>
      <div class="grid two">${Object.entries(p.summary || {}).map(([k, v]) => h`<div><div class="row between"><span>${t(dims[k] || k)}</span><strong>${v}</strong></div><div class="bar"><span style="width:${(v / 5) * 100}%"></span></div></div>`)}</div>
      <p class="muted" style="margin-top:8px">${t('Only people whose visit was geo-verified can review. The senior\'s rating counts 60%, the payer\'s 40%.')}</p>
      <ul class="list">${(p.reviews || []).map((r) => h`<li><div class="row between"><span class="stars" aria-label="${r.score} ${t('stars')}">${stars(r.score)}</span><small class="muted">${t(r.reviewerLabel)} · ${t('verified visit')} ${fmtDate(r.visitDate)}</small></div>${r.text ? h`<p style="margin:.3rem 0 0">${r.text}</p>` : ''}<small class="muted">${r.serviceName}</small>${r.reply ? h`<div class="card flat" style="margin:.5rem 0 0;padding:10px"><small><strong>${t('Reply from')} ${r.reply.by}:</strong> ${r.reply.text}</small></div>` : ''}</li>`)}</ul>
    </div>`;
}

export async function providerProfile(ctx) {
  const p = await api.get(`/providers/${ctx.params.id}`, { seniorId: ctx.state.seniorId });
  const html = h`${back('#/find')}<h1>${p.name}</h1><div class="row" style="margin-bottom:12px">${bandBadge(p.band, p.quality)} <span class="muted">${p.reviewCount} ${t('verified reviews')}</span></div>
    <div class="card"><h2>${t('Services and prices')}</h2>${p.listings.map((l) => h`<div class="row between" style="padding:.5rem 0;border-top:1px solid var(--line)"><span><strong>${l.title || tf(l, 'serviceName')}</strong><br><small class="muted">${t('Next free')}: ${l.nextSlot ? fmtDateTime(l.nextSlot) : '-'}</small></span><span class="row"><strong>${money(l.minCharge)}</strong><a class="btn small" href="#/book/${l.id}">${t('Book')}</a></span></div>`)}</div>
    ${providerBody(p)}`;
  return { title: p.name, html };
}

// ---------------- booking ----------------
export async function book(ctx) {
  const seniors = await api.get('/seniors');
  const sel = pickSenior(ctx, seniors);
  const l = await api.get(`/listings/${ctx.params.id}`, { seniorId: sel.id });
  const days = await api.get(`/listings/${l.id}/slots`, { days: 7 });
  const wallet = await api.get('/me/wallet');
  const rule = await api.get(`/seniors/${sel.id}/approval-rule`);
  const firstDay = days.find((d) => d.slots.some((s) => s.free)) || days[0];
  const html = h`${back(`#/listing/${l.id}`)}
    <h1>${t('Book')}: ${l.title || tf(l, 'serviceName')}</h1>
    <p class="muted">${l.provider.name} · ${t('minimum charge')} ${money(l.minCharge)} / ${t(l.unit)}</p>
    ${seniorChips(seniors, sel)}
    <form id="bk">
      <div class="card"><h2>1. ${t('Pick a day')}</h2>
        <div class="scroll-x" role="group" aria-label="${t('Day')}">${days.map((d) => { const free = d.slots.filter((s) => s.free).length; return h`<button type="button" class="chip ${d.date === firstDay.date ? 'on' : ''}" data-day="${d.date}" ${free ? '' : 'disabled'} style="flex:none">${fmtDay(Date.parse(d.date + 'T06:30:00Z'), ctx.now)}<small style="margin-left:4px;font-weight:500">${free ? free + ' ' + t('free') : t('full')}</small></button>`; })}</div>
        <h2 style="margin-top:14px">2. ${t('Pick a time')}</h2><div class="chips" id="slots"></div></div>
      ${l.addOns.length ? h`<div class="card"><h2>3. ${t('Add-ons')} <span class="hint">${t('optional')}</span></h2>${l.addOns.map((a) => h`<label class="check"><input type="checkbox" name="addOns" data-multi value="${a.name}"> ${a.name} <strong>+${money(a.price)}</strong></label>`)}</div>` : ''}
      <div class="card"><h2>${t('Repeat')}</h2>
        <div class="seg" role="radiogroup">${[['once', 'Just once'], ['weekdays', 'Weekdays'], ['daily', 'Daily'], ['weekly', 'Weekly']].map(([v, l2], i) => h`<button type="button" data-rep="${v}" class="${i === 0 ? 'on' : ''}">${t(l2)}</button>`)}</div>
        <div id="weeks" hidden><label>${t('For how many weeks?')} <span class="hint">${t('up to 12 weeks, one UPI AutoPay mandate')}</span></label><select name="weeks">${[1, 2, 4, 8, 12].map((w) => h`<option value="${w}" ${w === 4 ? 'selected' : ''}>${w}</option>`)}</select></div>
        <label for="notes">${t('Notes for the caregiver')}</label><textarea id="notes" name="notes" placeholder="${t('E.g. please bring a glucometer; ring the bell twice')}"></textarea></div>
      <div class="card"><h2>${t('Pay')}</h2>
        <div id="price"></div>
        <div class="chips" role="radiogroup" style="margin:10px 0">${[['upi', 'UPI'], ['card', 'Card (incl. international)'], ['netbanking', 'Net banking']].map(([v, l2], i) => h`<label class="chip"><input type="radio" name="method" value="${v}" ${i === 0 ? 'checked' : ''} style="width:18px;height:18px;min-height:0"> ${t(l2)}</label>`)}</div>
        ${wallet.balance ? h`<label class="check"><input type="checkbox" name="useCredit"> ${t('Use ElderLink credit')} (${money(wallet.balance)})</label>` : ''}
        <p class="muted" style="font-size:.9rem">${icon('lock', 16)} ${t('Money is held safely by an RBI-authorised payment partner and paid to the provider only after the visit is confirmed. ElderLink never asks for your OTP, PIN or password.')}</p>
        ${rule.enabled && !['owner'].includes(sel.myRole) ? h`<p class="alert amber">${t('Bookings over')} ${money(rule.threshold)} ${t('need approval from the care circle Owner.')}</p>` : ''}
        <button class="btn block" id="pay" disabled>${t('Choose a time first')}</button>
      </div>
    </form>`;
  return {
    title: 'Book', html,
    mount(el) {
      bindSeniorChips(el, ctx);
      let day = firstDay.date, slot = null, rep = 'once';
      const renderSlots = () => {
        const d = days.find((x) => x.date === day);
        const shown = d.slots.filter((s) => s.start > ctx.now);
        el.querySelector('#slots').innerHTML = shown.length ? shown.map((s) => `<button type="button" class="chip ${s.start === slot ? 'on' : ''}" data-slot="${s.start}" ${s.free ? '' : 'disabled'}>${fmtTime(s.start)}</button>`).join('') : `<p class="muted">${t('No slots on this day')}</p>`;
        el.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => { slot = Number(b.dataset.slot); renderSlots(); quote(); });
      };
      const quote = async () => {
        const f = formData(el.querySelector('#bk'));
        const q = await api.post('/bookings/quote', { listingId: l.id, seniorId: sel.id, addOns: f.addOns || [] });
        const p = q.price;
        el.querySelector('#price').innerHTML = h`<table><tr><td>${tf(l, 'serviceName')}</td><td style="text-align:right">${money(p.serviceValue)}</td></tr>
          ${p.addOnsValue ? h`<tr><td>${t('Add-ons')}</td><td style="text-align:right">${money(p.addOnsValue)}</td></tr>` : ''}
          ${p.discount ? h`<tr><td>${t('Plan discount')} (${p.discountPct}%)</td><td style="text-align:right">-${money(p.discount)}</td></tr>` : ''}
          <tr><td>${t('Platform fee')}</td><td style="text-align:right">${money(p.platformFee)}</td></tr><tr><td>${t('GST on platform fee')} (18%)</td><td style="text-align:right">${money(p.gst)}</td></tr>
          <tr><th style="color:var(--ink);font-size:1.1rem">${t('Total')}${rep !== 'once' ? h` <small class="muted">${t('per visit')}</small>` : ''}</th><th style="text-align:right;color:var(--ink);font-size:1.2rem">${money(p.total)}</th></tr></table>`.s;
        const btn = el.querySelector('#pay');
        btn.disabled = !slot;
        btn.textContent = slot ? `${t('Pay')} ${money(p.total)} · ${fmtDay(slot, ctx.now)} ${fmtTime(slot)}` : t('Choose a time first');
      };
      el.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { day = b.dataset.day; slot = null; el.querySelectorAll('[data-day]').forEach((x) => x.classList.toggle('on', x === b)); renderSlots(); quote(); });
      el.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => { rep = b.dataset.rep; el.querySelectorAll('[data-rep]').forEach((x) => x.classList.toggle('on', x === b)); el.querySelector('#weeks').hidden = rep === 'once'; quote(); });
      el.querySelectorAll('input[name=addOns]').forEach((c) => c.onchange = quote);
      renderSlots(); quote();
      el.querySelector('#bk').onsubmit = async (e) => {
        e.preventDefault();
        if (!slot) return;
        const f = formData(e.target);
        const btn = el.querySelector('#pay');
        btn.disabled = true; btn.textContent = t('Processing payment...');
        try {
          const r = await api.post('/bookings', { listingId: l.id, seniorId: sel.id, start: slot, addOns: f.addOns || [], notes: f.notes, method: f.method, useCredit: !!f.useCredit, recurrence: rep === 'once' ? null : { pattern: rep, weeks: Number(f.weeks) } });
          const b = r.first || r;
          ctx.state.compare.length = 0;
          if (b.status === 'pending_approval') toast(t('Sent to the care circle Owner for approval'));
          else toast(r.count ? `${r.count} ${t('visits booked under one mandate')}` : t('Booked and paid. The provider has been asked to accept.'));
          ctx.go(`#/booking/${b.id}`);
        } catch (err) { toast(err.message, true); btn.disabled = false; quote(); }
      };
    },
  };
}

export async function bookings(ctx) {
  const scope = ctx.query.scope || 'upcoming';
  const rows = await api.get('/bookings', { scope });
  const html = h`<div class="page-head"><h1>${t('Bookings')}</h1></div>
    <div class="seg" style="margin-bottom:14px">${[['upcoming', 'Upcoming'], ['past', 'Past']].map(([v, l]) => h`<button data-scope="${v}" class="${scope === v ? 'on' : ''}">${t(l)}</button>`)}</div>
    ${rows.length ? h`<div class="card"><ul class="list">${rows.map((b) => h`<li><a href="#/booking/${b.id}" style="text-decoration:none;color:inherit;display:block"><div class="row between"><strong>${tf(b, 'serviceName')}</strong>${statusBadge(b.status)}</div><div class="muted">${b.seniorName} · ${fmtDay(b.start, ctx.now)} ${fmtTime(b.start)} · ${b.caregiverName || b.providerName}</div>${b.price?.total ? h`<small>${money(b.price.total)}</small>` : h`<small>${t('Included in plan')}</small>`}</a></li>`)}</ul></div>` : empty(t('Nothing here yet.'), h`<a class="btn" href="#/find">${t('Find care')}</a>`)}`;
  return { title: 'Bookings', html, mount(el) { el.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => ctx.go(`#/bookings?scope=${b.dataset.scope}`)); } };
}

export async function review(ctx) {
  const b = await api.get(`/bookings/${ctx.params.id}`);
  const dims = [['punctuality', 'Punctuality'], ['skill', 'Skill'], ['behaviour', 'Behaviour and respect'], ['hygiene', 'Hygiene'], ['communication', 'Communication']];
  const html = h`${back(`#/booking/${b.id}`)}<h1>${t('Review')} ${b.caregiverName || b.providerName}</h1><p class="muted">${b.serviceName} · ${fmtDate(b.start)}</p>
    ${b.canReview ? h`<form id="rv" class="card">
      ${dims.map(([k, l]) => h`<fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:700">${t(l)}</legend><div class="chips">${[1, 2, 3, 4, 5].map((n) => h`<label class="chip"><input type="radio" name="${k}" value="${n}" ${n === 5 ? '' : ''} style="width:18px;height:18px;min-height:0" required> ${n} ★</label>`)}</div></fieldset>`)}
      <label>${t('Tags')}</label><div class="chips">${['on time', 'kind', 'skilled', 'explained well', 'late', 'rude', 'unsafe', 'did not come'].map((x) => h`<label class="chip"><input type="checkbox" name="tags" data-multi value="${x}" style="width:18px;height:18px;min-height:0"> ${t(x)}</label>`)}</div>
      <label for="tx">${t('Tell other families')} <span class="hint">${t('optional')}</span></label><textarea id="tx" name="text"></textarea>
      <button class="btn block" style="margin-top:12px">${t('Submit review')}</button></form>` : h`<div class="alert">${t(b.reviewBlockReason || '')}</div>`}`;
  return {
    title: 'Review', html,
    mount(el) {
      el.querySelector('#rv')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const ratings = Object.fromEntries(dims.map(([k]) => [k, Number(f[k])]));
        try { const r = await api.post(`/bookings/${b.id}/review`, { ratings, text: f.text, tags: f.tags }); toast(r.held ? t('Thanks. Your review is being checked before it is published.') : t('Thank you for your review')); ctx.go(`#/booking/${b.id}`); } catch (err) { toast(err.message, true); }
      });
    },
  };
}

export async function more(ctx) {
  const sid = ctx.state.seniorId || (await api.get('/seniors'))[0]?.id;
  const items = [
    [`#/plans/${sid}`, 'shield', 'Family plan', 'Check visits, coordinator, SOS'],
    [`#/circle/${sid}`, 'users', 'Care circle', 'Siblings, roles, approvals, tasks'],
    [`#/careplan/${sid}`, 'clipboard', 'Care plan', 'Goals, routines, preferences'],
    ['#/wallet', 'wallet', 'Payments and invoices', 'Refunds, credits, GST invoices'],
    [`#/summary/${sid}`, 'doc', 'Monthly care summary', 'Visits, vitals, adherence, spend'],
    ['#/programs', 'heart', 'Care programs', 'Post-hospital, rehab, diabetes, dementia'],
    ['#/equipment', 'cart', 'Equipment and products', 'Oxygen, beds, wheelchairs, grab bars'],
    ['#/events', 'music', 'Events and classes', 'Yoga, music, smartphone classes'],
    ['#/schemes', 'money', 'Government schemes', 'Ayushman Vay Vandana, pensions'],
    [`#/vault/${sid}`, 'lock', 'Document vault', 'ID, insurance, pension papers'],
    ['#/scam', 'alert', 'Scam shield', 'Alerts, verify before you pay, 1930'],
    [`#/safety/${sid}`, 'siren', 'Safety', 'Daily check-in, SOS test, safeguarding'],
    ['#/help', 'chat', 'Help and complaints', 'Grievance officer, 48-hour response'],
    ['#/settings', 'settings', 'Settings and privacy', 'Language, text size, consent, data'],
  ];
  const html = h`<div class="page-head"><h1>${t('More')}</h1></div><div class="grid two">${items.map(([href, ic, l, s]) => h`<a class="card" href="${href}" style="text-decoration:none;color:inherit;margin:0"><div class="row"><span class="avatar">${icon(ic)}</span><div><strong>${t(l)}</strong><br><small class="muted">${t(s)}</small></div></div></a>`)}</div>
    <div class="card" style="margin-top:14px"><h2>${icon('gift')} ${t('Invite a friend')}</h2><p class="muted">${t('Get Rs 500 credit when a family you invite subscribes.')}</p><form id="ref" class="row"><input name="mobile" placeholder="${t('Friend\'s mobile')}" inputmode="tel" style="flex:1"><button class="btn">${t('Send invite')}</button></form></div>`;
  return { title: 'More', html, mount(el) { el.querySelector('#ref').onsubmit = async (e) => { e.preventDefault(); try { const r = await api.post('/referral', formData(e.target)); toast(r.message); e.target.reset(); } catch (err) { toast(err.message, true); } }; } };
}

// ---------------- extended services ----------------
export async function equipment(ctx) {
  const [items, seniors] = await Promise.all([api.get('/equipment'), api.get('/seniors')]);
  const sel = pickSenior(ctx, seniors);
  const orders = sel ? await api.get('/equipment/orders', { seniorId: sel.id }) : [];
  const html = h`${back('#/more')}<h1>${t('Equipment and products')}</h1><p class="muted">${t('Delivered, installed and demonstrated at home by licensed partners. Oxygen breakdowns replaced within 4 hours.')}</p>
    ${seniorChips(seniors, sel)}
    ${orders.length ? h`<div class="card"><h2>${t('Your orders')}</h2><ul class="list">${orders.map((o) => h`<li><div class="row between"><strong>${o.name}</strong><span class="badge ${o.status === 'active' ? 'green' : 'info'}">${t(o.status.replace('_', ' '))}</span></div><small class="muted">${t(o.mode === 'rent' ? 'Rent' : 'Bought')} · ${money(o.amount)}${o.endsAt ? ` · ${t('until')} ${fmtDate(o.endsAt)}` : ''}</small>${o.fault ? h`<div class="alert amber">${t('Replacement on the way by')} ${fmtDateTime(o.fault.dueBy)}</div>` : ''}
      ${o.mode === 'rent' && o.status !== 'return_scheduled' ? h`<div class="btn-row" style="margin-top:6px"><button class="btn small soft" data-oa="extend" data-o="${o.id}">${t('Extend a month')}</button><button class="btn small ghost" data-oa="fault" data-o="${o.id}">${t('Report a fault')}</button><button class="btn small ghost" data-oa="return" data-o="${o.id}">${t('Return')}</button></div>` : ''}</li>`)}</ul></div>` : ''}
    <div class="grid two">${items.map((i) => h`<div class="card"><h3>${i.name}</h3><small class="muted">${i.partner} · ★ ${i.rating}</small><p style="margin-top:6px">${i.rentMonthly ? h`<strong>${money(i.rentMonthly)}</strong>/${t('month')} + ${money(i.deposit)} ${t('deposit')}<br>` : ''}${t('Buy')}: <strong>${money(i.price)}</strong></p><div class="btn-row">${i.rentMonthly ? h`<button class="btn small" data-rent="${i.id}">${t('Rent')}</button>` : ''}<button class="btn small soft" data-buy="${i.id}">${t('Buy')}</button></div></div>`)}</div>`;
  return {
    title: 'Equipment', html,
    mount(el) {
      bindSeniorChips(el, ctx);
      const order = async (id, mode) => { if (!(await confirmBox(`${t(mode === 'rent' ? 'Rent' : 'Buy')} ${items.find((x) => x.id === id).name}?`, { ok: t('Pay and schedule delivery') }))) return; try { await api.post('/equipment/orders', { itemId: id, seniorId: sel.id, mode, months: 1 }); toast(t('Ordered. Delivery and set-up tomorrow.')); ctx.refresh(); } catch (e) { toast(e.message, true); } };
      el.querySelectorAll('[data-rent]').forEach((b) => b.onclick = () => order(b.dataset.rent, 'rent'));
      el.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => order(b.dataset.buy, 'buy'));
      el.querySelectorAll('[data-oa]').forEach((b) => b.onclick = async () => { await api.post(`/equipment/orders/${b.dataset.o}/${b.dataset.oa}`, {}); toast(t('Done')); ctx.refresh(); });
    },
  };
}

export async function programs(ctx) {
  const [rows, seniors] = await Promise.all([api.get('/programs'), api.get('/seniors')]);
  const sel = pickSenior(ctx, seniors);
  const html = h`${back('#/more')}<h1>${t('Care programs')}</h1><p class="muted">${t('Buy an outcome, not single visits. A coordinator owns each program and shares weekly progress.')}</p>${seniorChips(seniors, sel)}
    <div class="grid two">${rows.map((p) => h`<div class="card"><h3>${p.name}</h3><p class="price">${money(p.price)} <small class="muted">/ ${p.days} ${t('days')}</small></p><ul>${p.includes.map((x) => h`<li>${x}</li>`)}</ul><p><strong>${t('Goal')}:</strong> ${p.goal}</p><button class="btn small block" data-enrol="${p.id}">${t('Enrol')} ${sel?.name.split(' ')[0] || ''}</button></div>`)}</div>`;
  return { title: 'Care programs', html, mount(el) { bindSeniorChips(el, ctx); el.querySelectorAll('[data-enrol]').forEach((b) => b.onclick = async () => { if (!(await confirmBox(t('Enrol and pay now?')))) return; try { const r = await api.post(`/programs/${b.dataset.enrol}/enrol`, { seniorId: sel.id }); toast(r.message); } catch (e) { toast(e.message, true); } }); } };
}

export async function events(ctx) {
  const seniors = await api.get('/seniors');
  const sel = pickSenior(ctx, seniors);
  const rows = await api.get('/events', { seniorId: sel?.id });
  const html = h`${back('#/more')}<h1>${t('Events and classes')}</h1>${seniorChips(seniors, sel)}
    ${rows.map((e) => h`<div class="card"><div class="row between top"><div><h3 style="margin:0">${tf(e, 'title')}</h3><div class="muted">${fmtDateTime(e.at)} · ${e.online ? t('Online') : e.venue} · ${e.language}</div><small>${e.host} · ${e.going} ${t('going')}</small></div><button class="btn small ${e.joined ? 'soft' : ''}" data-ev="${e.id}">${e.joined ? t('Going ✓') : t('Join')}</button></div></div>`)}`;
  return { title: 'Events', html, mount(el) { bindSeniorChips(el, ctx); el.querySelectorAll('[data-ev]').forEach((b) => b.onclick = async () => { await api.post(`/events/${b.dataset.ev}/rsvp`, { seniorId: sel.id }); ctx.refresh(); }); } };
}

export async function schemes(ctx) {
  const seniors = await api.get('/seniors');
  const sel = pickSenior(ctx, seniors);
  const res = await api.post('/entitlements/check', { seniorId: sel.id, bpl: ctx.query.bpl === '1', taxpayer: ctx.query.tax === '1' });
  const html = h`${back('#/more')}<h1>${t('Government schemes')}</h1><p class="muted">${t('Free cover and benefits families often do not know how to claim.')}</p>${seniorChips(seniors, sel)}
    <div class="card"><form id="f" class="row"><label class="check"><input type="checkbox" name="bpl" ${ctx.query.bpl === '1' ? 'checked' : ''}> ${t('Below poverty line card')}</label><label class="check"><input type="checkbox" name="tax" ${ctx.query.tax === '1' ? 'checked' : ''}> ${t('Pays income tax')}</label><button class="btn small">${t('Check')}</button></form></div>
    ${res.schemes.map((s) => h`<div class="card"><div class="row between"><h3 style="margin:0">${s.name}</h3>${s.eligible ? h`<span class="badge green">${t('Likely eligible')}</span>` : h`<span class="badge">${t('Not eligible')}</span>`}</div><p>${s.benefit}</p><small class="muted">${s.how}</small>${s.eligible ? (s.application ? h`<p><span class="badge info">${t(s.application.status.replace('_', ' '))}</span></p>` : h`<div style="margin-top:8px"><button class="btn small" data-apply="${s.id}">${t('Get help to apply')}</button></div>`) : ''}</div>`)}
    <p class="muted">${res.note}</p>`;
  return {
    title: 'Schemes', html,
    mount(el) {
      bindSeniorChips(el, ctx);
      el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const f = formData(e.target); ctx.go(`#/schemes?bpl=${f.bpl ? 1 : 0}&tax=${f.tax ? 1 : 0}`); };
      el.querySelectorAll('[data-apply]').forEach((b) => b.onclick = async () => { await api.post('/entitlements/apply', { seniorId: sel.id, schemeId: b.dataset.apply }); toast(t('A coordinator will call you to collect documents')); ctx.refresh(); });
    },
  };
}

export async function vault(ctx) {
  const rows = await api.get(`/seniors/${ctx.params.id}/vault`);
  const html = h`${back('#/more')}<h1>${t('Document vault')}</h1><p class="muted">${icon('lock', 16)} ${t('Stored encrypted. Shared only with the roles you choose.')}</p>
    <div class="card"><ul class="list">${rows.map((v) => h`<li class="row between"><span>${icon('doc')} <strong>${v.title}</strong> <small class="muted">${v.type} · ${v.fileName}</small></span><small class="muted">${t('Shared with')}: ${v.shareWith.join(', ')}</small></li>`)}</ul></div>
    <form id="f" class="card"><h2>${t('Add a document')}</h2><label>${t('Title')}</label><input name="title" required><label>${t('Type')}</label><select name="type">${['ID', 'Insurance', 'Pension', 'Property', 'Bank', 'Medical', 'Will'].map((x) => h`<option>${x}</option>`)}</select><label>${t('File')}</label><input type="file" name="file" id="file">
      <label>${t('Who can see it')}</label><div class="chips">${['owner', 'manager', 'viewer'].map((r) => h`<label class="chip"><input type="checkbox" name="shareWith" data-multi value="${r}" ${r !== 'viewer' ? 'checked' : ''} style="width:18px;height:18px;min-height:0"> ${t(r)}</label>`)}</div><button class="btn block" style="margin-top:12px">${t('Upload')}</button></form>`;
  return { title: 'Vault', html, mount(el) { el.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); const file = el.querySelector('#file').files[0]; try { await api.post(`/seniors/${ctx.params.id}/vault`, { title: f.title, type: f.type, shareWith: f.shareWith, fileName: file?.name || '', size: file?.size || 0 }); toast(t('Saved')); ctx.refresh(); } catch (err) { toast(err.message, true); } }; } };
}

export async function scamCentre(ctx) {
  const seniors = await api.get('/seniors');
  const sel = pickSenior(ctx, seniors);
  const [alerts, reports] = await Promise.all([api.get('/scam/alerts'), api.get('/scam/reports', { seniorId: sel.id })]);
  const html = h`${back('#/more')}<h1>${t('Scam shield')}</h1><p class="muted">${t('Digital-arrest and KYC scams mostly target the elderly. Your parent sees these alerts in their language, and can press "Verify before you pay" to reach you.')}</p>${seniorChips(seniors, sel)}
    <div class="grid two">${alerts.map((a) => h`<div class="card"><h3>${tf(a, 'title')}</h3><p>${tf(a, 'body')}</p></div>`)}</div>
    <div class="card"><h2>${t('Reports and verify requests')}</h2>${reports.length ? h`<ul class="list">${reports.map((r) => h`<li><div class="row between"><strong>${r.channel === 'verify' ? t('Verify before you pay') : t('Suspicious') + ' ' + r.channel}</strong><span class="badge ${r.lostMoney ? 'red' : 'info'}">${t(r.status)}</span></div><small class="muted">${fmtDateTime(r.createdAt)}</small><p>${r.text}</p>${r.advice ? h`<small>${t('Advice')}: ${r.advice}</small>` : ''}</li>`)}</ul>` : h`<p class="muted">${t('None so far.')}</p>`}</div>
    <div class="card"><h2>${t('If money was lost')}</h2><ol><li>${t('Call 1930 (National Cyber Crime Helpline) right now. Speed matters to freeze the money.')}</li><li>${t('File a complaint at cybercrime.gov.in and note the reference number.')}</li><li>${t('Call your bank to block the card / UPI and dispute the payment.')}</li></ol><a class="btn danger" href="tel:1930">${icon('phone', 20)} ${t('Call 1930')}</a></div>
    <div class="card flat"><h3>${t('Shared bank alerts')} <span class="badge">${t('coming soon')}</span></h3><p class="muted">${t('With your parent\'s explicit consent (revocable any time), you will be able to see bank transactions above an amount you set.')}</p></div>`;
  return { title: 'Scam shield', html, mount(el) { bindSeniorChips(el, ctx); } };
}

export async function safety(ctx) {
  const s = await api.get(`/seniors/${ctx.params.id}`);
  const checkins = await api.get(`/seniors/${s.id}/checkins`);
  const cs = s.checkinSettings || { enabled: false, time: '09:00' };
  const html = h`${back(`#/senior-profile/${s.id}`)}<h1>${t('Safety')}: ${s.name}</h1>
    <form id="ci" class="card"><h2>${t('Daily "Are you OK?" check-in')}</h2><p class="muted">${t('An automated call or app prompt at the time you choose. If there is no answer twice, 15 minutes apart, you and the coordinator are alerted.')}</p>
      <label class="check"><input type="checkbox" name="enabled" ${cs.enabled ? 'checked' : ''}> ${t('Turn on daily check-in')}</label>
      <label>${t('Time')}</label><input type="time" name="time" value="${cs.time}">
      <label class="check"><input type="checkbox" name="human" ${cs.human ? 'checked' : ''}> ${t('A person calls instead (subscribers)')}</label>
      <button class="btn" style="margin-top:8px">${t('Save')}</button></form>
    <div class="card"><h2>${t('Recent check-ins')}</h2>${checkins.length ? h`<ul class="list">${checkins.map((c) => h`<li class="row between"><span>${c.date}</span><span class="badge ${c.status === 'ok' ? 'green' : c.status === 'no_answer' || c.status === 'needs_help' ? 'red' : 'info'}">${t(c.status.replace('_', ' '))}</span></li>`)}</ul>` : h`<p class="muted">${t('None yet')}</p>`}</div>
    <div class="grid two">
      <div class="card"><h2>${t('Test SOS')}</h2><p class="muted">${t('Checks the phone and emergency contacts once a month. Nobody is dispatched.')}</p><button class="btn soft" data-test>${t('Run a test now')}</button></div>
      <div class="card"><h2>${t('Report abuse or neglect')}</h2><p class="muted">${t('Goes to a coordinator within 1 hour and, if needed, to Elderline 14567 or the police.')}</p><button class="btn danger ghost" data-safe>${t('Report a concern')}</button></div>
      <div class="card"><h2>${t('Home safety audit')}</h2><p class="muted">${t('A trained auditor checks lighting, rails and floors and gives a fix list you can book.')}</p><a class="btn soft" href="#/find?cat=daily&serviceId=svc_safety_audit&senior=${s.id}">${t('Book an audit')}</a></div>
    </div>`;
  return {
    title: 'Safety', html,
    mount(el) {
      el.querySelector('#ci').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); await api.put(`/seniors/${s.id}/checkin-settings`, f); toast(t('Saved')); ctx.refresh(); };
      el.querySelector('[data-test]').onclick = async () => { const r = await api.post(`/seniors/${s.id}/test-sos`, {}); toast(r.message); };
      el.querySelector('[data-safe]').onclick = () => modal(h`<h2>${t('Report a concern')}</h2><textarea id="tx" placeholder="${t('What happened?')}"></textarea><button class="btn danger block" style="margin-top:10px" data-go>${t('Send to coordinator')}</button>`, (m, close) => { m.querySelector('[data-go]').onclick = async () => { const r = await api.post(`/seniors/${s.id}/safeguard`, { text: m.querySelector('#tx').value }); close(); toast(r.message); }; });
    },
  };
}
