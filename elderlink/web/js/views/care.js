// Family subscription (FR-SUB), check visits (FR-CHK), medicines (FR-MED), vitals (FR-DSH-04),
// care circle and shared care plan (FR-FAM), payments wallet (FR-PAY) and the monthly summary.
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, modal, confirmBox, formData, fmtTime, fmtDate, fmtDateTime, money, statusBadge, lineChart, barList, empty, ago, initials } from '../ui.js';
import { pickSenior, seniorChips, bindSeniorChips } from './family.js';

const back = (href, label = 'Back') => h`<a class="back" href="${href}">${icon('back')} ${t(label)}</a>`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SUB_STATUS = { active: ['Active', 'green'], grace: ['Payment failed: grace period', 'amber'], lapsed: ['Lapsed', 'red'], cancelling: ['Ends at period end', 'amber'], cancelled: ['Cancelled', ''] };

// ---------- plans and subscription ----------
export async function plans(ctx) {
  const sid = ctx.params.id;
  const [list, cur, senior] = await Promise.all([api.get('/plans'), api.get(`/seniors/${sid}/subscription`), api.get(`/seniors/${sid}`)]);
  const sub = cur.subscription && cur.subscription.status !== 'cancelled' ? cur.subscription : null;
  const canManage = ['owner', 'manager'].includes(senior.myRole);
  const [sl, sc] = sub ? SUB_STATUS[sub.status] || [sub.status, ''] : [];
  const planCard = (p) => {
    const mine = sub?.planId === p.id;
    return h`<div class="card ${mine ? 'selected' : ''}" style="${p.id === 'plan_care' ? 'border-color:var(--brand)' : ''}">
      ${p.id === 'plan_care' ? h`<span class="badge brand">${t('Most chosen')}</span>` : ''}
      <h2 style="margin:.3rem 0">${tf(p, 'name')}</h2>
      <div class="price">${money(p.price)}<small class="muted"> / ${t('month')}</small></div>
      <small class="muted">${t('or')} ${money(p.price * 10)} / ${t('year')} (${t('2 months free')})</small>
      <ul class="ticks">${p.features.map((f) => h`<li>${icon('check', 18)} ${t(f)}</li>`)}</ul>
      ${mine ? h`<span class="badge green">${t('Current plan')}</span>`
        : canManage ? h`<button class="btn block ${p.id === 'plan_care' ? '' : 'soft'}" data-plan="${p.id}">${sub ? (p.price > sub.plan.price ? t('Upgrade now') : t('Switch at renewal')) : t('Choose')} ${tf(p, 'name')}</button>` : ''}
    </div>`;
  };
  const html = h`${back(`#/senior-profile/${sid}`)}
    <div class="page-head"><h1>${t('Family plan for')} ${senior.name.split(' ')[0]}</h1><p>${t('One monthly plan covers SOS, medicine tracking and nurse check visits. Visits you book are paid separately, with a discount on higher plans.')}</p></div>
    ${sub ? h`<div class="card">
      <div class="row between"><h2 style="margin:0">${tf(sub.plan, 'name')} ${t('plan')}</h2><span class="badge ${sc}">${t(sl)}</span></div>
      <dl class="kv" style="margin-top:.6rem">
        <dt>${t('Billing')}</dt><dd>${money(sub.plan.price * (sub.cycle === 'annual' ? 10 : 1))} ${sub.cycle === 'annual' ? t('per year') : t('per month')} · ${sub.method === 'upi_autopay' ? 'UPI AutoPay' : sub.method}</dd>
        <dt>${t('Next renewal')}</dt><dd>${fmtDate(sub.nextBillingAt)}</dd>
        ${sub.pendingPlan ? h`<dt>${t('Changing to')}</dt><dd>${tf(sub.pendingPlan, 'name')} ${t('from next renewal')}</dd>` : ''}
        <dt>${t('Check visit day')}</dt><dd>${t(WEEKDAYS[sub.checkDay?.weekday ?? 6])}, ${sub.checkDay?.time || '10:00'}</dd>
        ${sub.coordinator ? h`<dt>${t('Your care coordinator')}</dt><dd>${sub.coordinator.name} · ${sub.coordinator.mobile}</dd>` : ''}
      </dl>
      ${sub.status === 'grace' ? h`<div class="alert amber">${icon('alert')}<span>${t('The last payment failed. SOS and medicine reminders stay on until')} ${fmtDate(sub.graceUntil)}. ${t('Check visits are paused.')}</span><button class="btn small" data-paynow>${t('Pay now')}</button></div>` : ''}
      ${sub.status === 'lapsed' ? h`<div class="alert red">${icon('alert')}<span>${t('The plan has lapsed. SOS now goes to the desk without plan benefits.')}</span><button class="btn small" data-paynow>${t('Pay and restart')}</button></div>` : ''}
      ${canManage ? h`<div class="btn-row" style="margin-top:12px">
        <button class="btn soft small" data-checkday>${icon('calendar', 18)} ${t('Change check visit day')}</button>
        <button class="btn soft small" data-extra>${icon('plus', 18)} ${t('Extra check visit')}</button>
        <a class="btn soft small" href="#/summary/${sid}">${icon('chart', 18)} ${t('Monthly summary')}</a>
        ${sub.status !== 'cancelling' ? h`<button class="btn ghost small" data-cancel>${t('Cancel plan')}</button>` : ''}
        <button class="btn ghost small" data-fail title="${t('Demo only')}">${t('Demo: make next payment fail')}</button>
      </div>` : ''}
    </div>
    <div class="card"><h2>${t('Check visits')}</h2>${cur.checkVisits.length ? h`<ul class="timeline">${cur.checkVisits.slice().reverse().map((b) => h`<li><time>${fmtDateTime(b.start)}</time><a href="#/booking/${b.id}"><strong>${tf(b, 'serviceName')}</strong></a> ${statusBadge(b.status)} <span class="muted">${b.caregiverName || t('Nurse being assigned')}</span></li>`)}</ul>` : h`<p class="muted">${t('Being scheduled')}</p>`}</div>` : ''}
    <div class="section-title"><h2>${sub ? t('Change plan') : t('Choose a plan')}</h2></div>
    <div class="grid three">${list.map(planCard)}</div>
    <p class="muted" style="font-size:.9rem">${t('Prices include GST. Cancel any time; monthly plans run to the end of the paid month, annual plans refund unused full months.')}</p>`;
  return {
    title: 'Family plan', html,
    mount(el) {
      el.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => {
        const p = list.find((x) => x.id === b.dataset.plan);
        if (sub) {
          confirmBox(p.price > sub.plan.price ? t('Upgrade now? You pay only the difference for the rest of this month.') : t('Switch at the next renewal?'), { ok: t('Yes, change') }).then(async (ok) => {
            if (!ok) return;
            try { const r = await api.post(`/subscriptions/${sub.id}/change`, { planId: p.id }); toast(r.message); ctx.refresh(); } catch (e) { toast(e.message, true); }
          });
          return;
        }
        modal(h`<h2>${tf(p, 'name')} ${t('plan')}</h2>
          <form id="f"><div class="seg" role="radiogroup" aria-label="${t('Billing')}">
            <label><input type="radio" name="cycle" value="monthly" checked><span>${money(p.price)} / ${t('month')}</span></label>
            <label><input type="radio" name="cycle" value="annual"><span>${money(p.price * 10)} / ${t('year')}</span></label></div>
          <label>${t('Pay with')}</label><select name="method"><option value="upi_autopay">UPI AutoPay</option><option value="card">${t('Card (standing instruction)')}</option><option value="netbanking">${t('Net banking e-mandate')}</option></select>
          <p class="muted">${t('This is a demo. No money is taken.')}</p>
          <button class="btn block">${t('Start plan')}</button></form>`, (m, close) => {
          m.querySelector('#f').onsubmit = async (e) => {
            e.preventDefault();
            const f = formData(e.target);
            try { await api.post(`/seniors/${sid}/subscription`, { planId: p.id, cycle: f.cycle, method: f.method }); close(); toast(t('Plan active. Check visits are being scheduled.')); ctx.refresh(); } catch (err) { toast(err.message, true); }
          };
        });
      });
      el.querySelector('[data-paynow]')?.addEventListener('click', async () => { try { await api.post(`/subscriptions/${sub.id}/pay-now`, {}); toast(t('Paid. Plan is active again.')); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
        if (!(await confirmBox(t('Cancel the plan? SOS and check visits stop when the paid period ends.'), { ok: t('Cancel plan'), cancel: t('Keep plan'), danger: true }))) return;
        try { const r = await api.post(`/subscriptions/${sub.id}/cancel`); toast(r.message); ctx.refresh(); } catch (e) { toast(e.message, true); }
      });
      el.querySelector('[data-fail]')?.addEventListener('click', async () => { const r = await api.post(`/subscriptions/${sub.id}/simulate-failure`); toast(r.message); });
      el.querySelector('[data-checkday]')?.addEventListener('click', () => modal(h`<h2>${t('Check visit day')}</h2><form id="f">
        <label>${t('Day')}</label><select name="weekday">${WEEKDAYS.map((d, i) => h`<option value="${i}" ${i === (sub.checkDay?.weekday ?? 6) ? 'selected' : ''}>${t(d)}</option>`)}</select>
        <label>${t('Time')}</label><select name="time">${['09:00', '10:00', '11:00', '16:00', '17:00'].map((x) => h`<option ${x === sub.checkDay?.time ? 'selected' : ''}>${x}</option>`)}</select>
        <button class="btn block" style="margin-top:12px">${t('Save')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); try { await api.post(`/subscriptions/${sub.id}/checkday`, f); close(); toast(t('Saved. Upcoming visits moved.')); ctx.refresh(); } catch (err) { toast(err.message, true); } };
      }));
      el.querySelector('[data-extra]')?.addEventListener('click', async () => {
        if (!(await confirmBox(t('Book an extra check visit at the subscriber rate (20% off)?'), { ok: t('Book') }))) return;
        try { const b = await api.post(`/seniors/${sid}/extra-check`, { start: ctx.now + 2 * 864e5 }); toast(t('Booked. A nurse will be assigned.')); ctx.go(`#/booking/${b.id}`); } catch (e) { toast(e.message, true); }
      });
    },
  };
}

// ---------- medicines ----------
export async function medsIndex(ctx) {
  const seniors = await api.get('/seniors');
  const s = pickSenior(ctx, seniors);
  if (!s) return { title: 'Medicines', html: empty(t('Add your parent to get started.'), h`<a class="btn" href="#/add-senior">${t('Add a senior')}</a>`) };
  const out = await meds({ ...ctx, params: { id: s.id } });
  return { ...out, html: h`${seniorChips(seniors, s)}${out.html}`, mount(el) { bindSeniorChips(el, ctx); out.mount(el); } };
}

const DOSE_BADGE = { taken: ['Taken', 'green'], skipped: ['Skipped', 'amber'], missed: ['Missed', 'red'], later: ['Snoozed', 'info'], reminded: ['Reminder sent', 'info'], due: ['Due', ''] };

export async function meds(ctx) {
  const sid = ctx.params.id;
  const [senior, list, doses, adh] = await Promise.all([api.get(`/seniors/${sid}`), api.get(`/seniors/${sid}/medicines`), api.get(`/seniors/${sid}/doses`), api.get(`/seniors/${sid}/adherence?days=14`)]);
  const canManage = ['owner', 'manager'].includes(senior.myRole);
  const html = h`
    <div class="page-head row between"><div><h1>${t('Medicines')}: ${senior.name.split(' ')[0]}</h1><p>${t('Reminders go to the senior by app or voice call. Missed doses alert the family after 30 minutes.')}</p></div>
      <div class="btn-row">${canManage ? h`<button class="btn" data-add>${icon('plus', 20)} ${t('Add medicine')}</button><button class="btn soft" data-scan>${icon('camera', 20)} ${t('Scan prescription')}</button>` : ''}<a class="btn ghost" href="#/medchart/${sid}">${icon('print', 20)} ${t('Print chart')}</a></div></div>
    <div class="card"><h2>${t('Today')}</h2>
      ${doses.length ? h`<div class="stack">${doses.map((d) => {
        const [l, c] = DOSE_BADGE[d.status] || [d.status, ''];
        const open = ['due', 'reminded', 'later', 'missed'].includes(d.status);
        return h`<div class="row between" style="padding:.5rem 0;border-bottom:1px solid var(--line)">
          <div class="row"><span class="pill" style="background:${d.medicine?.color || '#eee'}" aria-hidden="true"></span><div><strong>${d.time}</strong> · ${d.medName}${d.critical ? h` <span class="badge red">${t('critical')}</span>` : ''}<br><small class="muted">${d.medicine?.dose || ''} ${d.medicine?.food ? '· ' + t(d.medicine.food) : ''}${d.takenAt ? ` · ${fmtTime(d.takenAt)} (${d.source})` : ''}</small></div></div>
          <div class="row"><span class="badge ${c}">${t(l)}</span>${open && d.due <= ctx.now + 3600e3 ? h`<button class="btn small soft" data-dose="${d.id}" data-st="taken">${t('Mark taken')}</button>` : ''}</div></div>`;
      })}</div>` : h`<p class="muted">${t('No doses today.')}</p>`}
    </div>
    <div class="grid two">
      <div class="card"><h2>${t('Adherence, last 14 days')}</h2><div class="price">${adh.overall ?? '-'}%</div>
        ${lineChart([{ name: t('Doses taken %'), color: '#0f766e', points: adh.days.filter((x) => x.pct != null).map((x) => ({ x: Date.parse(x.date), y: x.pct })) }], { yMin: 0, yMax: 100, height: 160, label: t('Adherence') })}
      </div>
      <div class="card"><h2>${t('By medicine')}</h2>${barList(adh.meds.map((m) => ({ label: m.name, value: m.pct ?? 0, display: m.pct == null ? '-' : m.pct + '%', color: (m.pct ?? 100) < 80 ? 'var(--amber)' : undefined })), { max: 100 })}</div>
    </div>
    <div class="section-title"><h2>${t('Medicine list')}</h2></div>
    ${list.length ? h`<div class="grid two">${list.map((m) => h`<div class="card">
      <div class="row between top"><div class="row"><span class="pill big" style="background:${m.color}" aria-hidden="true"></span><div><h3 style="margin:0">${m.name}</h3><small class="muted">${m.generic} · ${m.strength}</small></div></div>${m.critical ? h`<span class="badge red">${t('critical')}</span>` : ''}</div>
      <dl class="kv"><dt>${t('Dose')}</dt><dd>${m.dose}, ${t(m.food || '')}</dd><dt>${t('Times')}</dt><dd>${m.times.join(', ')}</dd>
        <dt>${t('Stock')}</dt><dd>${m.stock} ${m.daysLeft != null ? h`(${m.daysLeft} ${t('days')})` : ''} ${m.daysLeft != null && m.daysLeft <= 7 ? h`<span class="badge amber">${t('refill soon')}</span>` : ''}</dd>
        <dt>${t('7-day adherence')}</dt><dd>${m.adherence7 ?? '-'}%</dd><dt>${t('Prescribed by')}</dt><dd>${m.doctor || '-'}</dd></dl>
      ${canManage ? h`<div class="btn-row"><button class="btn small soft" data-stock="${m.id}">${t('Update stock')}</button><button class="btn small ghost" data-stop="${m.id}">${t('Stop medicine')}</button></div>` : ''}
    </div>`)}</div>` : empty(t('No medicines yet. Add them by hand or scan a prescription.'))}
    <p class="muted" style="font-size:.9rem">${icon('info', 16)} ${t('ElderLink only reminds and records. It never changes or suggests medicines. Always follow the doctor.')}</p>`;
  return {
    title: 'Medicines', html,
    mount(el) {
      el.querySelectorAll('[data-dose]').forEach((b) => b.onclick = async () => { try { await api.post(`/doses/${b.dataset.dose}`, { status: b.dataset.st }); toast(t('Marked as taken')); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      el.querySelector('[data-add]')?.addEventListener('click', () => medForm(sid, ctx));
      el.querySelector('[data-scan]')?.addEventListener('click', async () => {
        const r = await api.post(`/seniors/${sid}/medicines/scan`);
        modal(h`<h2>${icon('camera')} ${t('Read from prescription')}</h2><p class="alert">${icon('info')} ${t(r.note)}</p>
          <div class="stack">${r.extracted.map((x, i) => h`<label class="check card flat"><input type="checkbox" data-i="${i}" checked><span><strong>${x.name}</strong> ${x.strength}<br><small>${x.dose} · ${x.times.join(', ')} · ${t(x.food)} · ${t('confidence')} ${Math.round(x.confidence * 100)}%</small></span></label>`)}</div>
          <button class="btn block" data-save style="margin-top:12px">${t('Save checked medicines')}</button>`, (m, close) => {
          m.querySelector('[data-save]').onclick = async () => {
            const picks = [...m.querySelectorAll('[data-i]')].filter((c) => c.checked).map((c) => r.extracted[c.dataset.i]);
            const warnings = [];
            for (const p of picks) { const res = await api.post(`/seniors/${sid}/medicines`, { ...p, stock: 30 }); if (res.warning) warnings.push(res.warning); }
            close(); toast(warnings[0] || `${picks.length} ${t('medicines added')}`, !!warnings.length); ctx.refresh();
          };
        });
      });
      el.querySelectorAll('[data-stock]').forEach((b) => b.onclick = () => modal(h`<h2>${t('Update stock')}</h2><form id="f"><label>${t('Tablets at home now')}</label><input name="stock" inputmode="numeric" required><button class="btn block" style="margin-top:12px">${t('Save')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); await api.patch(`/medicines/${b.dataset.stock}`, { stock: Number(formData(e.target).stock) }); close(); toast(t('Saved')); ctx.refresh(); };
      }));
      el.querySelectorAll('[data-stop]').forEach((b) => b.onclick = async () => {
        if (!(await confirmBox(t('Stop this medicine? Only do this if the doctor said so.'), { ok: t('Stop'), danger: true }))) return;
        await api.patch(`/medicines/${b.dataset.stop}`, { active: false }); toast(t('Stopped')); ctx.refresh();
      });
    },
  };
}

function medForm(sid, ctx) {
  modal(h`<h2>${t('Add medicine')}</h2><form id="f">
    <label>${t('Medicine name (brand)')}</label><input name="name" required placeholder="Glycomet 500">
    <div class="grid two"><div><label>${t('Generic name')}</label><input name="generic" placeholder="Metformin"></div><div><label>${t('Strength')}</label><input name="strength" placeholder="500 mg"></div></div>
    <div class="grid two"><div><label>${t('Dose')}</label><input name="dose" value="1 tablet"></div><div><label>${t('With food')}</label><select name="food"><option>after food</option><option>before food</option><option>with food</option><option value="">${t('any time')}</option></select></div></div>
    <label>${t('Times each day')}</label><div class="chips">${['06:00', '08:00', '13:00', '14:00', '18:00', '20:00', '22:00'].map((x) => h`<label class="chip"><input type="checkbox" name="times" value="${x}" data-multi="1" ${x === '08:00' ? 'checked' : ''}> ${x}</label>`)}</div>
    <div class="grid two"><div><label>${t('Tablets in stock')}</label><input name="stock" inputmode="numeric" value="30"></div><div><label>${t('Doctor')}</label><input name="doctor"></div></div>
    <label class="check"><input type="checkbox" name="critical"> ${t('Critical medicine (insulin, blood thinner, seizure): alert family by call if missed')}</label>
    <button class="btn block" style="margin-top:12px">${t('Save')}</button></form>`, (m, close) => {
    m.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      try { const r = await api.post(`/seniors/${sid}/medicines`, f); close(); toast(r.warning || t('Medicine added. Reminders start today.'), !!r.warning); ctx.refresh(); } catch (err) { toast(err.message, true); }
    };
  });
}

export async function medchart(ctx) {
  const d = await api.get(`/seniors/${ctx.params.id}/medchart`);
  const html = h`<div class="no-print">${back(`#/meds/${ctx.params.id}`)}<button class="btn" data-print>${icon('print', 20)} ${t('Print')}</button></div>
    <div class="card print-sheet"><h1>${t('Medicine chart')}: ${d.senior.name}</h1><p class="muted">${t('Printed from ElderLink on')} ${fmtDate(ctx.now)}. ${t('Tick each box when the dose is taken.')}</p>
    <div class="table-wrap"><table class="table big"><thead><tr><th>${t('Medicine')}</th>${d.slots.map((s) => h`<th>${s}</th>`)}</tr></thead>
    <tbody>${d.meds.map((m) => h`<tr><td><span class="pill" style="background:${m.color}"></span> <strong>${m.name}</strong><br><small>${m.strength} · ${m.dose} · ${t(m.food || '')}</small></td>${d.slots.map((s) => h`<td style="text-align:center">${m.times.includes(s) ? '☐' : ''}</td>`)}</tr>`)}</tbody></table></div>
    <p style="margin-top:1rem">${t('Emergency')}: 112 · ${t('Ambulance')}: 108 · Elderline: 14567</p></div>`;
  return { title: 'Medicine chart', html, mount(el) { el.querySelector('[data-print]').onclick = () => window.print(); } };
}

// ---------- vitals ----------
export async function vitals(ctx) {
  const sid = ctx.params.id;
  const days = Number(ctx.query.days) || 90;
  const [senior, rows] = await Promise.all([api.get(`/seniors/${sid}`), api.get(`/seniors/${sid}/vitals?days=${days}`)]);
  const pts = (k) => rows.filter((v) => v[k] != null).map((v) => ({ x: v.at, y: v[k] }));
  const last = rows[rows.length - 1];
  const lightText = { green: 'Normal', amber: 'Watch', red: 'See a doctor' };
  const html = h`${back(`#/senior-profile/${sid}`)}
    <div class="page-head"><h1>${t('Vitals')}: ${senior.name}</h1><p>${t('Recorded by nurses at visits and check visits. Green is normal, amber needs watching, red needs a doctor.')}</p></div>
    <div class="seg" role="group">${[30, 90, 365].map((d) => h`<a class="${d === days ? 'on' : ''}" href="#/vitals/${sid}?days=${d}">${d} ${t('days')}</a>`)}</div>
    ${last ? h`<div class="card"><div class="row between"><h2 style="margin:0">${t('Latest')}: ${fmtDateTime(last.at)}</h2><span class="row"><span class="light ${last.status.overall}"></span> ${t(lightText[last.status.overall])}</span></div>
      <div class="grid four" style="margin-top:.6rem">${[['bp', 'Blood pressure', last.bpSys ? `${last.bpSys}/${last.bpDia}` : '-'], ['sugar', 'Sugar', last.sugar ?? '-'], ['spo2', 'SpO2', last.spo2 ? last.spo2 + '%' : '-'], ['pulse', 'Pulse', last.pulse ?? '-']].map(([k, l, v]) => h`<div class="stat"><div class="l">${t(l)}</div><div class="n"><span class="light ${last.status.parts[k] || 'green'}"></span> ${v}</div></div>`)}</div>
      <small class="muted">${t('By')} ${last.by} · ${t(last.source)}</small></div>` : empty(t('No readings yet. They appear after the first visit.'))}
    <div class="grid two">
      <div class="card"><h2>${t('Blood pressure')}</h2>${lineChart([{ name: t('Systolic'), color: '#c2410c', points: pts('bpSys') }, { name: t('Diastolic'), color: '#2563eb', points: pts('bpDia') }], { yMin: 60, yMax: 190, bands: [{ from: 60, to: 140, color: '#16a34a' }, { from: 160, to: 190, color: '#dc2626' }], label: t('Blood pressure') })}</div>
      <div class="card"><h2>${t('Blood sugar (fasting)')}</h2>${lineChart([{ name: t('Sugar'), color: '#7c3aed', points: pts('sugar') }], { yMin: 60, yMax: 260, bands: [{ from: 70, to: 180, color: '#16a34a' }], label: t('Sugar') })}</div>
      <div class="card"><h2>SpO2</h2>${lineChart([{ name: 'SpO2', color: '#0891b2', points: pts('spo2') }], { yMin: 85, yMax: 100, bands: [{ from: 94, to: 100, color: '#16a34a' }], label: 'SpO2' })}</div>
      <div class="card"><h2>${t('Weight')}</h2>${lineChart([{ name: t('Weight (kg)'), color: '#475569', points: pts('weight') }], { label: t('Weight') })}</div>
    </div>
    <div class="card"><h2>${t('All readings')}</h2><div class="table-wrap"><table class="table"><thead><tr><th>${t('Date')}</th><th>BP</th><th>${t('Sugar')}</th><th>SpO2</th><th>${t('Pulse')}</th><th>${t('By')}</th></tr></thead>
      <tbody>${rows.slice().reverse().map((v) => h`<tr><td><span class="light ${v.status.overall}"></span> ${fmtDate(v.at)}</td><td>${v.bpSys ?? '-'}/${v.bpDia ?? '-'}</td><td>${v.sugar ?? '-'}</td><td>${v.spo2 ?? '-'}</td><td>${v.pulse ?? '-'}</td><td>${v.by}</td></tr>`)}</tbody></table></div></div>`;
  return { title: 'Vitals', html };
}

// ---------- care circle ----------
export async function circle(ctx) {
  const sid = ctx.params.id;
  const [senior, tasks, act, rule] = await Promise.all([api.get(`/seniors/${sid}`), api.get(`/seniors/${sid}/tasks`), api.get(`/seniors/${sid}/activity`), api.get(`/seniors/${sid}/approval-rule`)]);
  const isOwner = senior.myRole === 'owner';
  const roleText = { owner: 'Owner: pays, manages everything', manager: 'Manager: books and manages care', viewer: 'Viewer: sees updates only' };
  const html = h`${back(`#/senior-profile/${sid}`)}
    <div class="page-head"><h1>${t('Care circle')}: ${senior.name.split(' ')[0]}</h1><p>${t('Everyone here gets updates. Choose what each person can do.')}</p></div>
    <div class="card"><div class="row between"><h2 style="margin:0">${t('Members')}</h2>${isOwner ? h`<button class="btn small" data-invite>${icon('plus', 18)} ${t('Invite')}</button>` : ''}</div>
      <div class="stack" style="margin-top:.6rem">${senior.circle.map((c) => h`<div class="row between" style="padding:.4rem 0;border-bottom:1px solid var(--line)">
        <div class="row"><span class="avatar">${initials(c.name)}</span><div><strong>${c.name}</strong> <span class="muted">(${t(c.relation)})</span>${c.nominee ? h` <span class="badge brand">${t('nominee')}</span>` : ''}${c.status === 'invited' ? h` <span class="badge amber">${t('invited')}</span>` : ''}<br><small class="muted">${t(roleText[c.role])}${c.tz && c.tz !== 'Asia/Kolkata' ? ' · ' + c.tz.split('/')[1] : ''}</small></div></div>
        ${isOwner && c.userId !== ctx.user.id ? h`<div class="row"><select data-role="${c.id}" aria-label="${t('Role')}">${['owner', 'manager', 'viewer'].map((r) => h`<option value="${r}" ${r === c.role ? 'selected' : ''}>${t(r[0].toUpperCase() + r.slice(1))}</option>`)}</select><button class="iconbtn" data-remove="${c.id}" aria-label="${t('Remove')}">${icon('x', 18)}</button></div>` : h`<span class="badge">${t(c.role[0].toUpperCase() + c.role.slice(1))}</span>`}
      </div>`)}</div></div>
    <div class="card"><h2>${t('Spending approval')}</h2><p class="muted">${t('Managers and the senior need the Owner to approve bookings above this amount.')}</p>
      <form id="rule" class="row" style="gap:12px;flex-wrap:wrap"><label class="check"><input type="checkbox" name="enabled" ${rule.enabled ? 'checked' : ''} ${isOwner ? '' : 'disabled'}> ${t('Ask me to approve bookings above')}</label>
        <input name="threshold" inputmode="numeric" value="${rule.threshold}" style="width:120px" ${isOwner ? '' : 'disabled'} aria-label="${t('Amount')}">${isOwner ? h`<button class="btn small">${t('Save')}</button>` : ''}</form></div>
    <div class="grid two">
      <div class="card"><div class="row between"><h2 style="margin:0">${t('Tasks')}</h2><button class="btn small soft" data-task>${icon('plus', 18)} ${t('Add task')}</button></div>
        <div class="stack" style="margin-top:.6rem">${tasks.length ? tasks.map((x) => h`<label class="check"><input type="checkbox" data-done="${x.id}" ${x.done ? 'checked' : ''}><span style="${x.done ? 'text-decoration:line-through;opacity:.6' : ''}">${x.title}<br><small class="muted">${x.assigneeName || ''}${x.due ? ' · ' + t('due') + ' ' + fmtDate(Date.parse(x.due)) : ''}</small></span></label>`) : h`<p class="muted">${t('No tasks yet.')}</p>`}</div></div>
      <div class="card"><h2>${t('Activity')}</h2><ul class="timeline">${act.slice(0, 25).map((a) => h`<li><time>${ago(a.createdAt, ctx.now)}</time><strong>${a.who}</strong> ${a.text}</li>`)}</ul></div>
    </div>`;
  return {
    title: 'Care circle', html,
    mount(el) {
      el.querySelector('[data-invite]')?.addEventListener('click', () => modal(h`<h2>${t('Invite to the care circle')}</h2><form id="f">
        <label>${t('Name')}</label><input name="name" required><label>${t('Mobile number')}</label><input name="mobile" inputmode="tel" required placeholder="98450 00000">
        <label>${t('Relation')}</label><select name="relation">${['daughter', 'son', 'daughter-in-law', 'son-in-law', 'grandchild', 'sibling', 'neighbour', 'friend'].map((r) => h`<option value="${r}">${t(r)}</option>`)}</select>
        <label>${t('Role')}</label><div class="stack">${['manager', 'viewer', 'owner'].map((r, i) => h`<label class="check"><input type="radio" name="role" value="${r}" ${i === 0 ? 'checked' : ''}> ${t(roleText[r])}</label>`)}</div>
        <button class="btn block" style="margin-top:12px">${t('Send invite by SMS and WhatsApp')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); try { await api.post(`/seniors/${sid}/circle`, formData(e.target)); close(); toast(t('Invite sent')); ctx.refresh(); } catch (err) { toast(err.message, true); } };
      }));
      el.querySelectorAll('[data-role]').forEach((s) => s.onchange = async () => { try { await api.patch(`/circle/${s.dataset.role}`, { role: s.value }); toast(t('Role changed')); } catch (e) { toast(e.message, true); ctx.refresh(); } });
      el.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => { if (!(await confirmBox(t('Remove this person from the care circle?'), { ok: t('Remove'), danger: true }))) return; try { await api.patch(`/circle/${b.dataset.remove}`, { remove: true }); ctx.refresh(); } catch (e) { toast(e.message, true); } });
      el.querySelector('#rule')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = formData(e.target); await api.put(`/seniors/${sid}/approval-rule`, f); toast(t('Saved')); ctx.refresh(); });
      el.querySelectorAll('[data-done]').forEach((c) => c.onchange = async () => { await api.patch(`/tasks/${c.dataset.done}`, { done: c.checked }); ctx.refresh(); });
      el.querySelector('[data-task]').onclick = () => modal(h`<h2>${t('Add task')}</h2><form id="f"><label>${t('What needs doing?')}</label><input name="title" required>
        <label>${t('Who')}</label><select name="assigneeId">${senior.circle.filter((c) => c.status !== 'removed').map((c) => h`<option value="${c.userId}" ${c.userId === ctx.user.id ? 'selected' : ''}>${c.name}</option>`)}</select>
        <label>${t('Due')}</label><input type="date" name="due"><button class="btn block" style="margin-top:12px">${t('Add')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => { e.preventDefault(); try { await api.post(`/seniors/${sid}/tasks`, formData(e.target)); close(); ctx.refresh(); } catch (err) { toast(err.message, true); } };
      });
    },
  };
}

// ---------- care plan ----------
export async function careplan(ctx) {
  const sid = ctx.params.id;
  const [senior, p] = await Promise.all([api.get(`/seniors/${sid}`), api.get(`/seniors/${sid}/careplan`)]);
  const canEdit = ['owner', 'manager'].includes(senior.myRole);
  const list = (arr) => (arr?.length ? h`<ul class="ticks">${arr.map((x) => h`<li>${icon('check', 18)} ${x}</li>`)}</ul>` : h`<p class="muted">-</p>`);
  const pref = p.preferences || {};
  const html = h`${back(`#/senior-profile/${sid}`)}
    <div class="page-head row between"><div><h1>${t('Care plan')}: ${senior.name.split(' ')[0]}</h1><p>${t('Every caregiver sees this before a visit.')} ${p.version ? `${t('Version')} ${p.version}${p.updatedBy ? ', ' + t('updated by') + ' ' + p.updatedBy : ''}` : ''}</p></div>${canEdit ? h`<button class="btn soft" data-edit>${icon('settings', 20)} ${t('Edit')}</button>` : ''}</div>
    <div class="grid two">
      <div class="card"><h2>${t('Goals')}</h2>${list(p.goals)}</div>
      <div class="card"><h2>${t('Daily routine')}</h2>${list(p.routines)}</div>
      <div class="card"><h2>${t('Preferences')}</h2><dl class="kv"><dt>${t('Food')}</dt><dd>${pref.food || '-'}</dd><dt>${t('Language')}</dt><dd>${pref.language || '-'}</dd><dt>${t('Faith and customs')}</dt><dd>${pref.religion || '-'}</dd></dl></div>
      <div class="card" style="border-color:var(--red)"><h2>${icon('alert')} ${t('Please do not')}</h2>${list(p.doNot)}</div>
    </div>`;
  return {
    title: 'Care plan', html,
    mount(el) {
      el.querySelector('[data-edit]')?.addEventListener('click', () => modal(h`<h2>${t('Edit care plan')}</h2><p class="muted">${t('One item per line.')}</p><form id="f">
        <label>${t('Goals')}</label><textarea name="goals" rows="3">${(p.goals || []).join('\n')}</textarea>
        <label>${t('Daily routine')}</label><textarea name="routines" rows="4">${(p.routines || []).join('\n')}</textarea>
        <label>${t('Food')}</label><input name="food" value="${pref.food || ''}"><label>${t('Language')}</label><input name="language" value="${pref.language || ''}"><label>${t('Faith and customs')}</label><input name="religion" value="${pref.religion || ''}">
        <label>${t('Please do not')}</label><textarea name="doNot" rows="3">${(p.doNot || []).join('\n')}</textarea>
        <button class="btn block" style="margin-top:12px">${t('Save')}</button></form>`, (m, close) => {
        m.querySelector('#f').onsubmit = async (e) => {
          e.preventDefault();
          const f = formData(e.target);
          const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
          await api.put(`/seniors/${sid}/careplan`, { goals: lines(f.goals), routines: lines(f.routines), doNot: lines(f.doNot), preferences: { food: f.food, language: f.language, religion: f.religion } });
          close(); toast(t('Saved. Caregivers will see the new version.')); ctx.refresh();
        };
      }));
    },
  };
}

// ---------- wallet ----------
export async function wallet(ctx) {
  const w = await api.get('/me/wallet');
  const payStatus = { escrow: ['Held until visit is confirmed', 'info'], released: ['Paid to provider', 'green'], captured: ['Paid', 'green'], refunded: ['Refunded', 'amber'], partially_refunded: ['Part refunded', 'amber'], failed: ['Failed', 'red'] };
  const html = h`<div class="page-head"><h1>${t('Payments')}</h1><p>${t('Your money for a visit is held safely and released to the provider only after the visit is confirmed.')}</p></div>
    <div class="grid three">
      <div class="stat"><div class="l">${t('ElderLink credit')}</div><div class="n">${money(w.balance)}</div><small class="muted">${t('Used automatically at checkout if you choose')}</small></div>
      ${w.spendBySenior.map((s) => h`<div class="stat"><div class="l">${t('Spent on')} ${s.name?.split(' ')[0]} (30 ${t('days')})</div><div class="n">${money(s.amount)}</div></div>`)}
    </div>
    <div class="card"><h2>${t('Payments')}</h2><div class="table-wrap"><table class="table"><thead><tr><th>${t('Date')}</th><th>${t('For')}</th><th>${t('Amount')}</th><th>${t('Status')}</th><th></th></tr></thead>
      <tbody>${w.payments.map((p) => { const [l, c] = payStatus[p.status] || [p.status, '']; return h`<tr><td>${fmtDate(p.createdAt)}</td><td>${p.purpose}<br><small class="muted">${p.method?.toUpperCase()}${p.fromCredit ? ` · ${t('credit')} ${money(p.fromCredit)}` : ''}</small></td><td><strong>${money(p.amount)}</strong>${p.refunded ? h`<br><small>-${money(p.refunded)} ${t('refunded')}</small>` : ''}</td><td><span class="badge ${c}">${t(l)}</span></td><td>${p.bookingId ? h`<a href="#/booking/${p.bookingId}">${t('Booking')}</a>` : ''}</td></tr>`; })}</tbody></table></div></div>
    <div class="grid two">
      <div class="card"><h2>${t('Refunds')}</h2>${w.refunds.length ? w.refunds.map((r) => h`<div class="row between" style="padding:.4rem 0"><span>${t(r.reason)}<br><small class="muted">${fmtDate(r.createdAt)} · ${t('to original payment method in 5 to 7 working days')}</small></span><strong>${money(r.amount)}</strong></div>`) : h`<p class="muted">${t('No refunds.')}</p>`}</div>
      <div class="card"><h2>${t('Credit history')}</h2>${w.credits.length ? w.credits.map((c) => h`<div class="row between" style="padding:.4rem 0"><span>${t(c.reason)}<br><small class="muted">${fmtDate(c.createdAt)}</small></span><strong>${c.amount > 0 ? '+' : ''}${money(c.amount)}</strong></div>`) : h`<p class="muted">${t('No credit yet.')}</p>`}</div>
    </div>`;
  return { title: 'Payments', html };
}

// ---------- monthly care summary ----------
export async function summary(ctx) {
  const d = await api.get(`/seniors/${ctx.params.id}/summary`);
  const last = d.vitals[d.vitals.length - 1];
  const first = d.vitals[0];
  const trend = first && last && first !== last && first.bpSys && last.bpSys ? last.bpSys - first.bpSys : null;
  const html = h`<div class="no-print">${back(`#/plans/${ctx.params.id}`)}<button class="btn soft" data-print>${icon('print', 20)} ${t('Print or save as PDF')}</button></div>
    <div class="card print-sheet"><h1>${t('Monthly care summary')}</h1><p class="muted">${d.senior.name}, ${d.senior.age} · ${fmtDate(d.from)} – ${fmtDate(d.to)}</p>
      <div class="grid four">
        <div class="stat"><div class="l">${t('Visits done')}</div><div class="n">${d.visitsDone}</div>${d.visitsMissed ? h`<small class="badge red">${d.visitsMissed} ${t('missed')}</small>` : ''}</div>
        <div class="stat"><div class="l">${t('Medicine adherence')}</div><div class="n">${d.adherence ?? '-'}%</div><small>${d.missedDoses} ${t('doses missed')}</small></div>
        <div class="stat"><div class="l">SOS</div><div class="n">${d.sos}</div></div>
        <div class="stat"><div class="l">${t('Spent')}</div><div class="n">${money(d.spend)}</div></div>
      </div>
      <h2>${t('Vitals')}</h2>${lineChart([{ name: t('Systolic BP'), color: '#c2410c', points: d.vitals.filter((v) => v.bpSys).map((v) => ({ x: v.at, y: v.bpSys })) }, { name: t('Sugar'), color: '#7c3aed', points: d.vitals.filter((v) => v.sugar).map((v) => ({ x: v.at, y: v.sugar })) }], { label: t('Vitals') })}
      ${trend != null ? h`<p>${trend < 0 ? `${t('Blood pressure came down by')} ${-trend} mmHg ${t('this month')}.` : trend > 0 ? `${t('Blood pressure went up by')} ${trend} mmHg ${t('this month')}.` : t('Blood pressure was steady.')}</p>` : ''}
      <p class="muted">${t('This summary is for the family and the doctor. It is not a diagnosis.')}</p></div>`;
  return { title: 'Monthly summary', html, mount(el) { el.querySelector('[data-print]').onclick = () => window.print(); } };
}


