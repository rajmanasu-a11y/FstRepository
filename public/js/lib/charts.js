import { html, escapeHtml, raw } from './dom.js';
import { fmtNumber } from './format.js';

/**
 * Small, dependency-free SVG charts. Single-series charts use one hue
 * (no legend; the card title names the series). Every chart ships with a
 * hover tooltip and a screen-reader table of the same values.
 */
const SERIES = '#256abf';
const SERIES_2 = '#eb6834';

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

/** Attach hover tooltips to [data-tip] hit targets inside root. */
export function bindTooltips(root) {
  const t = tooltip();
  root.addEventListener('mousemove', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) { t.hidden = true; root.querySelectorAll('.bar.hl').forEach((b) => b.classList.remove('hl')); return; }
    t.textContent = target.dataset.tip;
    t.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8);
    t.style.left = `${x}px`;
    t.style.top = `${e.clientY - t.offsetHeight - 10}px`;
    root.querySelectorAll('.bar.hl').forEach((b) => b.classList.remove('hl'));
    const bar = root.querySelector(`.bar[data-i="${target.dataset.i}"]`);
    bar?.classList.add('hl');
  });
  root.addEventListener('mouseleave', () => { t.hidden = true; });
}

function niceMax(v) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function srTable(caption, rows) {
  return html`<table class="sr-only"><caption>${caption}</caption><thead><tr><th>Label</th><th>Value</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td>${r.title || r.label}</td><td>${r.value}</td></tr>`)}</tbody></table>`;
}

/** Vertical columns: data = [{ label, value, title }] */
export function columnChart(data, { caption, height = 180, labelEvery = 1, unit = 'visitors' } = {}) {
  const W = 560;
  const H = height;
  const pad = { t: 12, r: 6, b: 24, l: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(3, band - 2));
  const ticks = [0, max / 2, max];
  const y = (v) => pad.t + ih - (v / max) * ih;
  const parts = [];
  for (const t of ticks) {
    parts.push(`<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`);
    parts.push(`<text x="${pad.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${fmtNumber(t)}</text>`);
  }
  data.forEach((d, i) => {
    const x = pad.l + i * band + (band - bw) / 2;
    const h = (d.value / max) * ih;
    if (h > 0) {
      const r = Math.min(4, h, bw / 2);
      const top = y(d.value);
      const base = pad.t + ih;
      parts.push(`<path class="bar" data-i="${i}" fill="${SERIES}" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`);
    }
    const tipText = `${d.title || d.label}: ${fmtNumber(d.value)} ${unit}`;
    parts.push(`<rect class="hit" data-i="${i}" data-tip="${escapeHtml(tipText)}" x="${pad.l + i * band}" y="${pad.t}" width="${band}" height="${ih}"/>`);
    if (i % labelEvery === 0) parts.push(`<text x="${pad.l + i * band + band / 2}" y="${H - 7}" text-anchor="middle">${escapeHtml(d.label)}</text>`);
  });
  parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#c3ccd7"/>`);
  return html`<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption}">${raw(parts.join(''))}</svg>${srTable(caption, data)}</div>`;
}

/** Horizontal ranked bars (single series): data = [{ label, value }] */
export function barList(data, { caption, unit = 'visitors' } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return html`<div class="hbar-list" role="list" aria-label="${caption}">${data.map((d) => html`
    <div class="hbar-row" role="listitem" title="${d.label}: ${fmtNumber(d.value)} ${unit}">
      <span class="lbl">${d.label}</span>
      <span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="width:${Math.max(2, (d.value / max) * 100)}%"></span></span>
      <span class="val">${fmtNumber(d.value)}</span>
    </div>`)}</div>`;
}

/** Two-part share bar with legend + direct values (e.g. repeat vs first-time). */
export function splitBar(a, b, { caption }) {
  const total = a.value + b.value || 1;
  const pa = (a.value / total) * 100;
  return html`<div class="chart" aria-label="${caption}">
    <div style="display:flex;gap:2px;height:14px;border-radius:4px;overflow:hidden;background:#eef1f5" aria-hidden="true">
      ${a.value ? html`<span data-tip="${a.label}: ${a.value}" style="width:${pa}%;background:${SERIES}"></span>` : ''}
      ${b.value ? html`<span data-tip="${b.label}: ${b.value}" style="flex:1;background:${SERIES_2}"></span>` : ''}
    </div>
    <div class="legend mt-1">
      <span><i style="background:${SERIES}"></i>${a.label} <b>${fmtNumber(a.value)}</b> (${Math.round(pa)}%)</span>
      <span><i style="background:${SERIES_2}"></i>${b.label} <b>${fmtNumber(b.value)}</b> (${Math.round(100 - pa)}%)</span>
    </div>
    ${srTable(caption, [a, b])}
  </div>`;
}
