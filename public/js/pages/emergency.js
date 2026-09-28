import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, download } from '../lib/api.js';
import { session } from '../lib/state.js';
import { openPrint } from '../lib/router.js';
import { fmtTime, fmtDateTime, fmtNumber } from '../lib/format.js';
import { emptyState, loadingBlock, toastError } from '../lib/ui.js';

export default async function emergency(root) {
  const showContact = session.settings.security?.showContactOnEmergencyList !== false;
  render(root, html`
    <div class="emergency-head">
      <div>
        <h1 style="color:#7a1911">Emergency Visitor Accountability</h1>
        <div class="muted" data-asof>Everyone currently recorded as on premises</div>
      </div>
      <div class="row">
        <div class="right"><div class="count" data-count>–</div><div class="muted">persons on premises</div></div>
        <div class="divider-v"></div>
        <button type="button" class="btn danger lg" data-print autofocus>${icon('printer')}Print Emergency Roll Call</button>
        <button type="button" class="btn lg" data-pdf>${icon('download')}Download PDF</button>
        <button type="button" class="btn lg ghost" data-refresh>${icon('refresh')}Refresh</button>
      </div>
    </div>
    <div data-groups>${loadingBlock('Loading on-premises list…')}</div>`);

  async function load() {
    try {
      const data = await api('/reports/emergency');
      $('[data-count]', root).textContent = fmtNumber(data.total);
      $('[data-asof]', root).textContent = `As at ${fmtDateTime(data.generatedAt)} · employees are accounted for through the staff attendance system`;
      render($('[data-groups]', root), data.total ? html`${data.groups.map((g) => html`
        <section class="card roll-group" aria-labelledby="grp-${g.key}">
          <div class="card-header"><h2 id="grp-${g.key}">${g.title} <span class="pill-count">${g.items.length}</span></h2></div>
          ${g.items.length ? html`<div class="table-wrap"><table class="data roll-table">
            <thead><tr><th>Name</th><th>Company</th><th>Host</th><th>Location / Access Area</th><th>Check-In</th>${showContact ? html`<th>Contact</th>` : ''}<th>Pass No.</th></tr></thead>
            <tbody>${g.items.map((r) => html`<tr class="${r.status === 'OVERSTAY' ? 'row-alert' : ''}">
              <td><b>${r.visitor}</b></td><td>${r.company || '—'}</td><td>${r.host}${showContact && r.hostMobile ? html`<div class="cell-sub">${r.hostMobile}</div>` : ''}</td>
              <td>${r.accessArea || '—'}</td><td>${fmtTime(r.checkIn)}</td>${showContact ? html`<td class="mono">${r.mobile || '—'}</td>` : ''}<td class="code-ref">${r.passNumber || '—'}</td></tr>`)}</tbody>
          </table></div>` : html`<div class="card-body muted">None recorded.</div>`}
        </section>`)}` : emptyState('No visitors are currently on premises', 'The roll call list is empty.', 'checkCircle'));
    } catch (err) { toastError(err); }
  }
  on(root, 'click', '[data-print]', () => openPrint('/print/emergency'));
  on(root, 'click', '[data-pdf]', async () => { try { await download('/reports/emergency/export'); } catch (err) { toastError(err); } });
  on(root, 'click', '[data-refresh]', load);
  await load();
  $('[data-print]', root).focus();
  const t = setInterval(load, 60_000);
  return () => clearInterval(t);
}
