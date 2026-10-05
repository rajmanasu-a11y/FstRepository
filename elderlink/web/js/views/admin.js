// Admin console: business and safety reports (FR-ADM-05), business rules (FR-ADM-01),
// service catalogue and plans, and the tamper-evident audit log (REG-07).
import { api } from '../api.js';
import { t, tf } from '../i18n.js';
import { h, icon, toast, formData, fmtDateTime, money, barList, empty } from '../ui.js';

const BAND_COLORS = { excellent: '#15803d', good: '#0b6b62', fair: '#b45309', review: '#b3261e', new: '#64748b' };

export async function reports(ctx) {
  const [r, rec] = await Promise.all([api.get('/admin/reports'), api.get('/ops/reconciliation')]);
  const html = h`<div class="page-head"><h1>${t('Reports')}</h1><p>${t('Last 30 days')} · ${t('Bengaluru pilot')}</p></div>
    <div class="grid four">
      <div class="stat"><div class="l">${t('Care booked (GMV)')}</div><div class="n">${money(r.gmv)}</div></div>
      <div class="stat"><div class="l">${t('ElderLink commission')}</div><div class="n">${money(r.commission)}</div></div>
      <div class="stat"><div class="l">${t('Subscriptions (MRR)')}</div><div class="n">${money(r.mrr)}</div><small>${r.subscriptions} ${t('active')} · ${t('churn')} ${r.churnPct}%</small></div>
      <div class="stat"><div class="l">${t('Bookings')}</div><div class="n">${r.bookings}</div></div>
      <div class="stat"><div class="l">${t('SOS cases')}</div><div class="n">${r.sos.cases}</div><small>${t('acknowledged in 60 s')}: ${r.sos.under60 ?? '-'}%</small></div>
      <div class="stat"><div class="l">${t('SOS acknowledge time')}</div><div class="n">${r.sos.p50 ?? '-'}s</div><small>p95 ${r.sos.p95 ?? '-'}s</small></div>
      <div class="stat"><div class="l">${t('Verified providers')}</div><div class="n">${r.providers}</div></div>
      <div class="stat"><div class="l">${t('Seniors on the platform')}</div><div class="n">${r.seniors}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>${t('Bookings by status')}</h2>${barList(Object.entries(r.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: t(k.replace('_', ' ')), value: v })))}</div>
      <div class="card"><h2>${t('Caregiver quality bands')}</h2>${barList(Object.entries(r.quality).map(([k, v]) => ({ label: t({ excellent: 'Excellent (85+)', good: 'Good (70-84)', fair: 'Fair (60-69)', review: 'Under review (<60)', new: 'New' }[k]), value: v, color: BAND_COLORS[k] })))}</div>
      <div class="card"><h2>${t('Plans')}</h2>${barList(Object.entries(r.byPlan).map(([k, v]) => ({ label: k, value: v })))}</div>
      <div class="card"><h2>${t('Live listings by service')}</h2>${barList(Object.entries(r.supply).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ label: k, value: v })))}</div>
      <div class="card"><h2>${t('Complaints')}</h2><dl class="kv"><dt>${t('Open')}</dt><dd>${r.grievances.open}</dd><dt>${t('Acknowledgement overdue')}</dt><dd>${r.grievances.ackOverdue}</dd><dt>${t('Resolved')}</dt><dd>${r.grievances.resolved}</dd></dl></div>
      <div class="card"><h2>${t('Money reconciliation')}</h2><dl class="kv"><dt>${t('Captured')}</dt><dd>${money(rec.captured)}</dd><dt>${t('Refunded')}</dt><dd>${money(rec.refunded)}</dd><dt>${t('In escrow')}</dt><dd>${money(rec.inEscrow)}</dd><dt>${t('Paid out')}</dt><dd>${money(rec.paidOut)}</dd><dt>${t('Payouts scheduled')}</dt><dd>${rec.payoutsScheduled}</dd></dl>
        ${rec.mismatches.length ? h`<div class="alert amber">${rec.mismatches.length} ${t('mismatches')}: ${rec.mismatches.slice(0, 3).map((m) => m.issue).join('; ')}</div>` : h`<div class="alert green">${icon('check')} ${t('All payments reconcile')}</div>`}
        <button class="btn small soft" data-payouts>${t('Run payouts now')}</button></div>
    </div>`;
  return { title: 'Reports', html, mount(el) { el.querySelector('[data-payouts]').onclick = async () => { try { const x = await api.post('/ops/payouts/run'); toast(`${x.paid} ${t('payouts sent')}`); ctx.refresh(); } catch (e) { toast(e.message, true); } }; } };
}

export async function config(ctx) {
  const c = await api.get('/admin/config');
  const f = (k, l, hint) => h`<div><label for="${k}">${t(l)}</label><input id="${k}" name="${k}" inputmode="numeric" value="${c[k]}">${hint ? h`<span class="hint">${t(hint)}</span>` : ''}</div>`;
  const w = c.qualityWeights;
  const html = h`<div class="page-head"><h1>${t('Rules and prices')}</h1><p>${t('Changes apply to new bookings only and are recorded in the audit log.')}</p></div>
    <form id="f" class="card"><h2>${t('Money')}</h2><div class="grid three">
      ${f('commissionPct', 'Commission %')}${f('trustedCommissionPct', 'Commission for trusted providers %', 'Quality score 90+')}${f('platformFee', 'Platform fee per booking (₹)', 'GST 18% added on this fee only')}
      ${f('approvalThreshold', 'Default family approval limit (₹)')}${f('medianLowFlagPct', 'Flag prices this % below median')}${f('checkInRadiusM', 'Check-in radius (metres)')}</div>
      <h2>${t('Quality score weights')}</h2><div class="grid three">${Object.entries(w).map(([k, v]) => h`<div><label>${t({ reviews: 'Reviews', onTime: 'On time', checklist: 'Checklist done', repeat: 'Repeat families', complaints: 'No complaints' }[k])}</label><input name="w_${k}" inputmode="numeric" value="${v}"></div>`)}</div>
      <p class="hint">${t('Weights must add up to 100.')}</p><button class="btn">${t('Save rules')}</button></form>`;
  return {
    title: 'Rules', html,
    mount(el) {
      el.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(e.target);
        const weights = Object.fromEntries(Object.keys(w).map((k) => [k, Number(v['w_' + k])]));
        if (Object.values(weights).reduce((a, b) => a + b, 0) !== 100) return toast(t('Weights must add up to 100.'), true);
        const body = { qualityWeights: weights };
        for (const k of ['commissionPct', 'trustedCommissionPct', 'platformFee', 'approvalThreshold', 'medianLowFlagPct', 'checkInRadiusM']) body[k] = Number(v[k]);
        try { await api.patch('/admin/config', body); toast(t('Saved')); ctx.refresh(); } catch (err) { toast(err.message, true); }
      };
    },
  };
}

export async function catalogue(ctx) {
  const [services, plans] = await Promise.all([api.get('/services'), api.get('/plans')]);
  const cats = ['RN', 'GNM', 'ANM', 'GDA', 'PHYSIO', 'DOCTOR', 'COMPANION', 'CONCIERGE'];
  const html = h`<div class="page-head"><h1>${t('Catalogue')}</h1><p>${t('Who may deliver each service, and the city median used to flag unusual prices.')}</p></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>${t('Service')}</th><th>${t('Unit')}</th><th>${t('Median ₹')}</th><th>${t('Allowed')}</th><th></th></tr></thead><tbody>
      ${services.map((s) => h`<tr data-svc="${s.id}"><td><strong>${tf(s, 'name')}</strong></td><td>${t(s.unit)}</td><td><input name="median" value="${s.medianPrice}" inputmode="numeric" style="width:90px"></td>
        <td><div class="chips">${cats.map((c) => h`<label class="chip" style="min-height:32px"><input type="checkbox" value="${c}" ${s.allowed.includes(c) ? 'checked' : ''}> ${c}</label>`)}</div></td><td><button class="btn small soft" data-save>${t('Save')}</button></td></tr>`)}
    </tbody></table></div></div>
    <div class="section-title"><h2>${t('Family plans')}</h2></div>
    <div class="grid three">${plans.map((p) => h`<form class="card" data-plan="${p.id}"><h3>${tf(p, 'name')}</h3><label>${t('Price per month (₹)')}</label><input name="price" value="${p.price}" inputmode="numeric"><label>${t('Check visits per month')}</label><input name="checkVisits" value="${p.checkVisits}" inputmode="numeric"><label>${t('Booking discount %')}</label><input name="discountPct" value="${p.discountPct}" inputmode="numeric"><button class="btn small soft" style="margin-top:10px">${t('Save')}</button></form>`)}</div>`;
  return {
    title: 'Catalogue', html,
    mount(el) {
      el.querySelectorAll('[data-svc]').forEach((tr) => tr.querySelector('[data-save]').onclick = async () => {
        const allowed = [...tr.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => c.value);
        if (!allowed.length) return toast(t('Pick at least one category'), true);
        try { await api.patch(`/admin/services/${tr.dataset.svc}`, { medianPrice: Number(tr.querySelector('[name=median]').value), allowed }); toast(t('Saved')); } catch (e) { toast(e.message, true); }
      });
      el.querySelectorAll('[data-plan]').forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); try { await api.patch(`/admin/plans/${f.dataset.plan}`, formData(f)); toast(t('Saved. Applies from the next renewal.')); } catch (err) { toast(err.message, true); } });
    },
  };
}

export async function audit() {
  const rows = await api.get('/admin/audit');
  const html = h`<div class="page-head"><h1>${t('Audit log')}</h1><p>${t('Every access to health data, every rule change and every verification decision. Kept for 7 years.')}</p></div>
    ${rows.length ? h`<div class="card"><div class="table-wrap"><table><thead><tr><th>${t('When')}</th><th>${t('Who')}</th><th>${t('Action')}</th><th>${t('Record')}</th></tr></thead><tbody>
      ${rows.map((a) => h`<tr><td>${fmtDateTime(a.createdAt)}</td><td>${a.userName}</td><td><code>${a.action}</code></td><td>${a.target || ''}</td></tr>`)}</tbody></table></div></div>` : empty(t('Nothing logged yet.'))}`;
  return { title: 'Audit log', html };
}
