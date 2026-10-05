// Senior mode (SRS 5.1, FR-DSH-05): at most four big actions per screen, permanent SOS,
// large text, voice read-out, Hindi and English.
import { api } from '../api.js';
import { t, tf, lang } from '../i18n.js';
import { h, icon, toast, speak, fmtTime, fmtDay, fmtDate, initials, modal, confirmBox } from '../ui.js';

const back = (href = '#/senior') => h`<a class="back" href="${href}">${icon('back')} ${t('Back')}</a>`;

function greeting(now) {
  const hr = new Date(now + 330 * 60000).getUTCHours();
  return hr < 12 ? t('Good morning') : hr < 17 ? t('Good afternoon') : t('Good evening');
}

export function sosButton() {
  return h`<button class="tile sos pulse" data-sos aria-label="${t('SOS emergency. Press and hold for 3 seconds')}">
    <span class="fill"></span><span class="ic">${icon('siren', 34)}</span>
    <span><span class="t">SOS</span><br><span class="s">${t('Press and hold 3 seconds')}</span></span></button>`;
}

/** Long-press (3 s) to send; Enter / Space opens a confirmation instead. */
export function bindSos(el, ctx, seniorId) {
  const btn = el.querySelector('[data-sos]');
  if (!btn) return;
  const fill = btn.querySelector('.fill');
  let timer = null, start = 0, raf = 0;
  const send = async () => {
    try {
      let lat, lng;
      try {
        // never let a pending location permission prompt delay the SOS: give up after 2 s and use the home address
        const pos = await Promise.race([
          new Promise((res, rej) => { if (!navigator.geolocation) return rej(); navigator.geolocation.getCurrentPosition(res, rej, { timeout: 2000, maximumAge: 60000 }); }),
          new Promise((_, rej) => setTimeout(rej, 2000)),
        ]);
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      } catch { /* use the registered address */ }
      if (ctx.state.offline) toast(t('No data connection: sending SMS with your location and calling the SOS number'));
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      await api.post('/sos', { seniorId, offline: !!ctx.state.offline, lat: ctx.state.offline ? undefined : lat, lng: ctx.state.offline ? undefined : lng });
      speak(t('Help is coming. Our emergency team will call you now. Your family has been told.'));
      ctx.go(ctx.user.role === 'senior' ? '#/senior/sos' : '#/home');
    } catch (e) { toast(e.message, true); }
  };
  const tick = () => { const p = Math.min(1, (Date.now() - start) / 3000); fill.style.width = `${p * 100}%`; if (p < 1) raf = requestAnimationFrame(tick); };
  const down = (e) => { if (e.button > 0) return; e.preventDefault(); start = Date.now(); tick(); timer = setTimeout(() => { timer = null; cancelAnimationFrame(raf); fill.style.width = '100%'; send(); }, 3000); };
  const up = () => { if (timer) { clearTimeout(timer); timer = null; cancelAnimationFrame(raf); fill.style.width = '0'; toast(t('Keep holding the SOS button for 3 seconds')); } };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (await confirmBox(t('Send SOS now?'), { ok: t('Yes, send SOS'), cancel: t('No'), danger: true })) send();
  });
}

export async function home(ctx) {
  const d = await api.get('/senior/home');
  if (!d.senior) return { html: h`<div class="card"><p>${t('No senior profile yet.')}</p></div>` };
  const s = d.senior;
  const first = s.name.split(' ')[0];
  const due = d.dueNow.filter((x) => x.status !== 'taken');
  const v = d.nextVisit;
  const say = `${greeting(ctx.now)} ${first}. ${due.length ? `${t('You have')} ${due.length} ${t('medicines to take now')}.` : t('No medicines due right now.')} ${v ? `${t('Next visit')}: ${v.caregiverName || v.providerName}, ${fmtDay(v.start, ctx.now)} ${fmtTime(v.start)}.` : ''}`;
  let banner = '';
  if (d.openCase) banner = h`<a class="senior-banner warn" href="#/senior/sos" style="text-decoration:none;color:inherit">${icon('siren', 36)}<div><div class="t">${t('Help is on the way')}</div><div>${t('Tap to see what is happening')}</div></div></a>`;
  else if (d.askCheckin) banner = h`<div class="senior-banner"><div style="flex:1"><div class="t">${t('Are you OK today?')}</div><div class="btn-row" style="margin-top:.6rem"><button class="big-btn green" data-ok style="min-height:60px">${icon('check', 26)} ${t('I am OK')}</button><button class="big-btn amber" data-help style="min-height:60px">${t('I need help')}</button></div></div></div>`;
  else if (d.toReview) banner = h`<a class="senior-banner" href="#/senior/rate/${d.toReview.id}" style="text-decoration:none;color:inherit">${icon('star', 36)}<div><div class="t">${t('How was the visit?')}</div><div>${d.toReview.caregiverName}: ${t('tap to give stars')}</div></div></a>`;
  else if (d.pendingRequests.length) banner = h`<div class="senior-banner">${icon('clock', 36)}<div><div class="t">${t('Waiting for your family')}</div><div>${tf(d.pendingRequests[0], 'serviceName')}: ${t('they have been asked to approve')}</div></div></div>`;
  const html = h`
    <div class="row between top">
      <div><div class="senior-greet">${greeting(ctx.now)}, ${first}</div><div class="senior-sub">${fmtDate(ctx.now)}</div></div>
      <button class="speak" data-say>${icon('volume', 22)} ${t('Read aloud')}</button>
    </div>
    ${banner}
    <div class="tiles">
      <a class="tile meds" href="#/senior/meds">${due.length ? h`<span class="badge red">${due.length} ${t('now')}</span>` : ''}<span class="ic">${icon('pill', 30)}</span><span><span class="t">${t("Today's medicines")}</span><br><span class="s">${d.doses.taken}/${d.doses.total} ${t('taken')}</span></span></a>
      <a class="tile visit" href="#/senior/visit"><span class="ic">${icon('nurse', 30)}</span><span><span class="t">${t('Next visit')}</span><br><span class="s">${v ? h`${v.caregiverName || v.providerName}<br>${fmtDay(v.start, ctx.now)} ${fmtTime(v.start)}` : t('None booked')}</span></span></a>
      <a class="tile family" href="#/senior/family"><span class="ic">${icon('video', 30)}</span><span><span class="t">${t('Call family')}</span><br><span class="s">${d.family.slice(0, 2).map((m) => m.name.split(' ')[0]).join(', ')}</span></span></a>
      <a class="tile" href="#/senior/more"><span class="ic">${icon('menu', 30)}</span><span><span class="t">${t('More help')}</span><br><span class="s">${t('Book help, scam check, nurse')}</span></span></a>
      ${sosButton()}
    </div>`;
  return {
    title: 'Home', html,
    mount(el) {
      el.querySelector('[data-say]').onclick = () => speak(say);
      bindSos(el, ctx, s.id);
      el.querySelector('[data-ok]')?.addEventListener('click', async () => { await api.post(`/seniors/${s.id}/imok`, { ok: true }); toast(t('Thank you! Have a good day.')); speak(t('Thank you! Have a good day.')); ctx.refresh(); });
      el.querySelector('[data-help]')?.addEventListener('click', async () => { await api.post(`/seniors/${s.id}/imok`, { ok: false }); toast(t('We are calling you now. Your family has been told.')); ctx.refresh(); });
    },
  };
}

function pill(m) {
  const shape = m?.shape === 'oval' ? 'oval' : m?.shape === 'pen' ? 'pen' : '';
  return h`<span class="pill-img ${shape}" style="background:${m?.color || '#eee'}">${m?.form === 'injection' ? icon('drip', 26) : ''}</span>`;
}

export async function meds(ctx) {
  const d = await api.get('/senior/home');
  const now = ctx.now;
  const items = d.dosesToday;
  const label = (x) => ({ taken: t('Taken'), skipped: t('Skipped'), missed: t('Missed'), later: t('Later'), due: '', reminded: '' }[x.status] || '');
  const html = h`${back()}
    <div class="row between"><h1>${t("Today's medicines")}</h1><button class="speak" data-say>${icon('volume', 22)} ${t('Read aloud')}</button></div>
    ${items.length ? items.map((x) => {
      const actionable = ['due', 'reminded', 'later', 'missed'].includes(x.status) && x.due <= now + 30 * 60000;
      return h`<div class="pill-card ${x.status === 'taken' ? 'done' : ''}">
        ${pill(x.medicine)}
        <div style="flex:1"><div class="nm">${x.medicine?.name || x.medName}</div><div>${x.medicine?.dose} · ${fmtTime(x.due)}${x.medicine?.food ? ` · ${t(x.medicine.food)}` : ''}</div>
          ${x.critical ? h`<span class="badge red">${t('Important')}</span>` : ''} ${label(x) ? h`<span class="badge ${x.status === 'taken' ? 'green' : x.status === 'missed' ? 'red' : 'amber'}">${label(x)}</span>` : ''}
          ${actionable ? h`<div class="btn-row" style="margin-top:.6rem"><button class="big-btn green" data-dose="${x.id}" data-st="taken" style="min-height:58px">${icon('check', 24)} ${t('Taken')}</button><button class="big-btn ghost" data-dose="${x.id}" data-st="later" style="min-height:58px">${t('Later')}</button><button class="big-btn ghost" data-dose="${x.id}" data-st="skipped" style="min-height:58px">${t('Skip')}</button></div>` : ''}
        </div></div>`;
    }) : h`<p>${t('No medicines today.')}</p>`}
    <p class="muted">${t('ElderLink only reminds you of what your doctor prescribed. Ask your doctor before changing any medicine.')}</p>`;
  const say = items.filter((x) => x.status !== 'taken').map((x) => `${x.medicine?.name}, ${x.medicine?.dose}, ${fmtTime(x.due)}`).join('. ') || t('All medicines for now are taken.');
  return {
    title: "Today's medicines", html,
    mount(el) {
      el.querySelector('[data-say]').onclick = () => speak(say);
      el.querySelectorAll('[data-dose]').forEach((b) => b.onclick = async () => {
        await api.post(`/doses/${b.dataset.dose}`, { status: b.dataset.st });
        if (b.dataset.st === 'taken') { toast(t('Well done!')); speak(t('Well done!')); }
        else if (b.dataset.st === 'later') toast(t('We will remind you again in 15 minutes'));
        else toast(t('Your family will be told that you skipped this dose'));
        ctx.refresh();
      });
    },
  };
}

export async function visit(ctx) {
  const d = await api.get('/senior/home');
  const v = d.nextVisit;
  if (!v) return { html: h`${back()}<h1>${t('Next visit')}</h1><p>${t('No visit is booked.')}</p><a class="big-btn" href="#/senior/help">${icon('plus', 26)} ${t('Ask for help')}</a>` };
  const isToday = fmtDay(v.start, ctx.now) === t('Today');
  const html = h`${back()}
    <h1>${t('Next visit')}</h1>
    <div class="card"><div class="row"><span class="avatar lg">${initials(v.caregiverName || v.providerName)}</span><div><div style="font-size:1.25rem;font-weight:800">${v.caregiverName || t('Caregiver to be assigned')}</div><div>${v.caregiver?.category || v.providerName}</div></div></div>
      <p style="font-size:1.2rem;margin-top:.8rem"><strong>${fmtDay(v.start, ctx.now)}, ${fmtTime(v.start)}</strong><br>${tf(v, 'serviceName')}</p>
      ${v.caregiver?.badges?.length ? h`<div class="chips">${v.caregiver.badges.map((b) => h`<span class="badge green">${icon('check', 14)} ${t(b)}</span>`)}</div>` : ''}
    </div>
    ${v.visitCode ? h`<div class="card"><h2>${t('Your visit code')}</h2><p>${t('Tell this code to the nurse only when they are at your door. It proves the visit happened.')}</p><div class="code-box" aria-label="${v.visitCode.split('').join(' ')}">${v.visitCode}</div><button class="speak" style="margin-top:.6rem" data-code>${icon('volume', 22)} ${t('Read the code aloud')}</button></div>` : ''}
    <div class="big-stack">
      ${v.status === 'in_progress' ? h`<div class="alert green">${icon('check')} ${t('The caregiver has checked in.')}</div>` : ''}
      <button class="big-btn ghost" data-call>${icon('phone', 26)} ${t('Call the caregiver')}</button>
      ${isToday ? '' : h`<p class="muted">${t('You will get a reminder on the day.')}</p>`}
    </div>`;
  return {
    title: 'Next visit', html,
    mount(el) {
      el.querySelector('[data-code]')?.addEventListener('click', () => speak(`${t('Your visit code is')} ${v.visitCode.split('').join(' ')}`));
      el.querySelector('[data-call]').onclick = async () => { const r = await api.post(`/bookings/${v.id}/call`, { to: 'caregiver' }); toast(r.message); };
    },
  };
}

export async function familyCall(ctx) {
  const d = await api.get('/senior/home');
  const html = h`${back()}<h1>${t('Call family')}</h1>
    <div class="big-stack">${d.family.map((m) => h`<button class="big-btn ${m.nominee ? '' : 'ghost'}" data-call="${m.userId}" style="justify-content:flex-start"><span class="avatar">${initials(m.name)}</span><span style="text-align:left">${m.name}<br><small style="font-weight:600">${t(m.relation)}</small></span><span style="margin-left:auto">${icon('video', 28)}</span></button>`)}</div>`;
  return {
    title: 'Call family', html,
    mount(el) {
      el.querySelectorAll('[data-call]').forEach((b) => b.onclick = async () => {
        const r = await api.post(`/seniors/${d.senior.id}/videocall`, { userId: b.dataset.call });
        modal(h`<div style="text-align:center"><div class="avatar lg" style="margin:0 auto 12px">${initials(r.name)}</div><h2>${t('Calling')} ${r.name}...</h2><p class="muted">${t('Video call (simulated in this demo)')}</p><button class="big-btn red" data-close>${icon('x', 26)} ${t('End call')}</button></div>`);
      });
    },
  };
}

export async function more(ctx) {
  const html = h`${back()}<h1>${t('More help')}</h1>
    <div class="big-stack">
      <a class="big-btn" href="#/senior/help">${icon('plus', 26)} ${t('Ask for help at home')}</a>
      <a class="big-btn ghost" href="#/senior/scam">${icon('shield', 26)} ${t('Is this call a scam?')}</a>
      <button class="big-btn ghost" data-nurse>${icon('phone', 26)} ${t('Talk to a nurse (24x7)')}</button>
      <a class="big-btn ghost" href="#/senior/events">${icon('music', 26)} ${t('Classes and events')}</a>
    </div>
    <div class="card" style="margin-top:16px"><h3>${t('Make the screen easier')}</h3>
      <div class="seg" role="group" aria-label="${t('Text size')}">${[['large', 'A'], ['xl', 'A+'], ['xxl', 'A++']].map(([v, l]) => h`<button data-size="${v}" class="${(ctx.user.prefs.textSize || 'large') === v ? 'on' : ''}" style="font-size:${v === 'large' ? 1 : v === 'xl' ? 1.2 : 1.4}rem">${l}</button>`)}</div>
      <div class="btn-row" style="margin-top:.8rem"><button class="btn ghost" data-contrast>${icon('eye', 20)} ${ctx.user.prefs.contrast ? t('Normal colours') : t('High contrast')}</button><button class="btn ghost" data-lang2>${icon('globe', 20)} ${lang() === 'hi' ? 'English' : 'हिंदी'}</button></div>
    </div>`;
  return {
    title: 'More help', html,
    mount(el) {
      el.querySelector('[data-nurse]').onclick = async () => {
        const q = await askText(t('What is the problem? (you can leave this empty)'));
        if (q === null) return;
        const r = await api.post('/helpline', { question: q });
        toast(r.message); speak(r.message);
        if (r.sos) ctx.go('#/senior/sos');
      };
      el.querySelectorAll('[data-size]').forEach((b) => b.onclick = async () => { await api.patch('/me', { prefs: { textSize: b.dataset.size } }); ctx.refresh(); });
      el.querySelector('[data-contrast]').onclick = async () => { await api.patch('/me', { prefs: { contrast: !ctx.user.prefs.contrast } }); ctx.refresh(); };
      el.querySelector('[data-lang2]').onclick = async () => { await api.patch('/me', { language: lang() === 'hi' ? 'en' : 'hi' }); ctx.refresh(); };
    },
  };
}

function askText(label) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(h`<h2>${label}</h2><textarea id="q" rows="3"></textarea><div class="btn-row" style="margin-top:1rem"><button class="big-btn" data-ok>${t('Call me now')}</button></div>`, (m) => {
      m.querySelector('[data-ok]').onclick = () => { done = true; const v = m.querySelector('#q').value; close(); resolve(v); };
    });
    const iv = setInterval(() => { if (!document.querySelector('.modal-bg')) { clearInterval(iv); if (!done) resolve(null); } }, 300);
  });
}

export async function askHelp(ctx) {
  const opts = [['nurse', 'Nurse at home', 'nurse'], ['attendant', 'Attendant for the day', 'attendant'], ['escort', 'Someone to take me to hospital', 'escort'], ['errand', 'Groceries, bank or bills', 'errand']];
  const html = h`${back('#/senior/more')}<h1>${t('Ask for help at home')}</h1><p>${t('Choose one. We find a trusted, verified person nearby and ask your family to approve.')}</p>
    <div class="big-stack">${opts.map(([k, l, ic]) => h`<button class="big-btn ghost" data-kind="${k}" style="justify-content:flex-start">${icon(ic, 30)} ${t(l)}</button>`)}</div>`;
  return {
    title: 'Ask for help', html,
    mount(el) {
      el.querySelectorAll('[data-kind]').forEach((b) => b.onclick = async () => {
        try {
          const r = await api.post('/senior/request', { kind: b.dataset.kind });
          const msg = r.booking ? `${t('Done.')} ${r.booking.providerName}, ${fmtDay(r.booking.start, ctx.now)} ${fmtTime(r.booking.start)}. ${t('Your family has been asked to approve.')}` : t('A coordinator will call you shortly.');
          speak(msg);
          modal(h`<div style="text-align:center">${icon('check', 64, 3)}<h2>${msg}</h2><a class="big-btn" href="#/senior" data-close>${t('OK')}</a></div>`);
        } catch (e) { toast(e.message, true); }
      });
    },
  };
}

export async function scam(ctx) {
  const d = await api.get('/senior/home');
  const a = d.scamAlert;
  const html = h`${back('#/senior/more')}<h1>${t('Is this call a scam?')}</h1>
    ${a ? h`<div class="card" style="border:2px solid var(--amber)"><div class="row between"><strong>${t('This week')}</strong><button class="speak" data-say>${icon('volume', 22)} ${t('Read aloud')}</button></div><h2 style="margin-top:.5rem">${tf(a, 'title')}</h2><p>${tf(a, 'body')}</p></div>` : ''}
    <div class="big-stack">
      <button class="big-btn" data-verify>${icon('shield', 28)} ${t('Verify before you pay')}</button>
      <button class="big-btn ghost" data-report>${icon('alert', 28)} ${t('Report a strange call or message')}</button>
      <button class="big-btn red" data-lost>${icon('money', 28)} ${t('I think I lost money')}</button>
    </div>
    <div class="alert amber" style="margin-top:16px">${icon('lock')}<div><strong>${t('Never share your OTP, PIN or password with anyone.')}</strong> ${t('ElderLink, banks and police never ask for them.')}</div></div>`;
  return {
    title: 'Scam check', html,
    mount(el) {
      el.querySelector('[data-say]')?.addEventListener('click', () => speak(`${tf(a, 'title')}. ${tf(a, 'body')}`));
      el.querySelector('[data-verify]').onclick = async () => { const r = await api.post('/scam/verify', {}); speak(r.message); modal(h`<h2>${r.message}</h2><button class="big-btn" data-close>${t('OK')}</button>`); };
      el.querySelector('[data-report]').onclick = async () => { const r = await api.post('/scam/report', { channel: 'call', text: 'Reported from senior app' }); modal(h`<h2>${t('Thank you for telling us')}</h2><ul>${r.steps.map((s) => h`<li style="margin-bottom:.5rem">${t(s)}</li>`)}</ul><button class="big-btn" data-close>${t('OK')}</button>`); };
      el.querySelector('[data-lost]').onclick = async () => { const r = await api.post('/scam/report', { channel: 'call', lostMoney: true, text: 'Senior thinks money was lost' }); speak(t('Call 1930 now.')); modal(h`<h2>${t('Act fast')}</h2><ol>${r.steps.map((s) => h`<li style="margin-bottom:.5rem">${t(s)}</li>`)}</ol><a class="big-btn red" href="tel:1930">${icon('phone', 26)} ${t('Call 1930 now')}</a><p class="muted" style="margin-top:.6rem">${t('Your family has been alerted.')}</p>`); };
    },
  };
}

export async function rate(ctx) {
  const b = await api.get(`/bookings/${ctx.params.id}`);
  let score = 0;
  const tags = new Set();
  const goodTags = ['Kind', 'On time', 'Skilled', 'Clean'];
  const badTags = ['Late', 'rude', 'did not come', 'unsafe'];
  const html = h`${back()}<h1>${t('How was the visit?')}</h1>
    <div class="card" style="text-align:center"><div class="avatar lg" style="margin:0 auto 8px">${initials(b.caregiverName)}</div><h2>${b.caregiverName}</h2><p>${tf(b, 'serviceName')} · ${fmtDay(b.start, ctx.now)}</p>
      <div class="stars-big" role="radiogroup" aria-label="${t('Stars')}">${[1, 2, 3, 4, 5].map((n) => h`<button role="radio" aria-checked="false" aria-label="${n} ${t('stars')}" data-star="${n}">★</button>`)}</div>
    </div>
    <div class="chips" id="tags" style="justify-content:center;margin-bottom:16px">${[...goodTags, ...badTags].map((x) => h`<button class="chip" data-tag="${x}">${t(x)}</button>`)}</div>
    ${b.canReview ? h`<button class="big-btn" data-send disabled>${t('Send')}</button>` : h`<p class="alert">${t(b.reviewBlockReason || 'Thank you, already rated.')}</p>`}`;
  return {
    title: 'Rate visit', html,
    mount(el) {
      const btns = el.querySelectorAll('[data-star]');
      btns.forEach((x) => x.onclick = () => { score = Number(x.dataset.star); btns.forEach((y) => { const on = Number(y.dataset.star) <= score; y.classList.toggle('on', on); y.setAttribute('aria-checked', String(Number(y.dataset.star) === score)); }); const s = el.querySelector('[data-send]'); if (s) s.disabled = false; });
      el.querySelectorAll('[data-tag]').forEach((x) => x.onclick = () => { const k = x.dataset.tag; if (tags.has(k)) tags.delete(k); else tags.add(k); x.classList.toggle('on'); });
      el.querySelector('[data-send]')?.addEventListener('click', async () => {
        try {
          await api.post(`/bookings/${b.id}/review`, { overall: score, tags: [...tags].map((x) => x.toLowerCase()), channel: 'app' });
          speak(t('Thank you!')); toast(t('Thank you!')); ctx.go('#/senior');
        } catch (e) { toast(e.message, true); }
      });
    },
  };
}

export async function sosLive(ctx) {
  const d = await api.get('/senior/home');
  const c = d.openCase;
  if (!c) return { html: h`${back()}<div class="card"><h2>${t('No emergency is open.')}</h2><p>${t('If you need help, press and hold SOS.')}</p></div><div class="tiles">${sosButton()}</div>`, mount: (el) => bindSos(el, ctx, d.senior.id) };
  const steps = [['open', 'SOS received'], ['acknowledged', 'Emergency desk is calling you'], ['in_progress', 'Help is being arranged']];
  const idx = steps.findIndex((s) => s[0] === c.status);
  const html = h`${back()}
    <div class="sos-live"><h1>${t('Help is coming')}</h1><p style="font-size:1.15rem">${t('Stay calm. Keep your phone near you. Your family has been told.')}</p></div>
    <div class="card"><ol class="timeline">${steps.map((s, i) => h`<li class="${i <= idx ? '' : 'muted'}"><strong>${i <= idx ? '✓ ' : ''}${t(s[1])}</strong></li>`)}
      ${c.ambulance ? h`<li><strong>${t('Ambulance on the way')}</strong> ${c.ambulance.vehicle} · ${t('about')} ${c.ambulance.eta} ${t('min')}</li>` : ''}</ol>
      ${c.agentName ? h`<p>${t('Talking to you')}: <strong>${c.agentName}</strong></p>` : ''}
    </div>
    <a class="big-btn ghost" href="tel:112">${icon('phone', 26)} ${t('Call 112')}</a>`;
  return { title: 'SOS', html, mount() { speak(t('Help is coming. Stay calm.')); } };
}

export async function events(ctx) {
  const d = await api.get('/senior/home');
  const rows = await api.get('/events', { seniorId: d.senior.id });
  const html = h`${back('#/senior/more')}<h1>${t('Classes and events')}</h1>
    ${rows.map((e) => h`<div class="card"><div class="row between top"><div><h2 style="margin:0">${tf(e, 'title')}</h2><div>${fmtDay(e.at, ctx.now)}, ${fmtTime(e.at)} · ${e.online ? t('Online') : e.venue}</div><small class="muted">${e.language} · ${e.going} ${t('going')}</small></div></div>
      <button class="big-btn ${e.joined ? 'green' : 'ghost'}" data-ev="${e.id}" style="margin-top:.6rem;min-height:56px">${e.joined ? h`${icon('check', 24)} ${t('You are going')}` : t('Join')}</button></div>`)}`;
  return {
    title: 'Events', html,
    mount(el) { el.querySelectorAll('[data-ev]').forEach((b) => b.onclick = async () => { const r = await api.post(`/events/${b.dataset.ev}/rsvp`, {}); toast(r.joined ? t('You are registered. We will remind you.') : t('Removed')); ctx.refresh(); }); },
  };
}
