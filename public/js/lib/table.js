import { html } from './dom.js';
import { icon } from './icons.js';
import { fmtNumber } from './format.js';

/**
 * Render a data table.
 * columns: [{ key, label, sortable, num, cls, render(row) }]
 */
export function dataTable({ columns, rows, sort, dir, rowAttrs, caption, footer, empty }) {
  if (!rows.length && empty) return empty;
  return html`
    <div class="table-wrap">
      <table class="data">
        ${caption ? html`<caption class="sr-only">${caption}</caption>` : ''}
        <thead><tr>${columns.map((c) => {
          const sorted = sort === c.key;
          const ariaSort = sorted ? (dir === 'asc' ? 'ascending' : 'descending') : null;
          return html`<th scope="col" class="${c.num ? 'num' : ''} ${c.thCls || ''}" ${ariaSort ? html`aria-sort="${ariaSort}"` : ''}>${
            c.sortable
              ? html`<button type="button" class="sort-btn" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label}${icon(sorted ? (dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'arrowUpDown')}</button>`
              : c.label}</th>`;
        })}</tr></thead>
        <tbody>${rows.map((r, i) => {
          const attrs = rowAttrs ? rowAttrs(r, i) : {};
          return html`<tr class="${attrs.cls || ''}" ${attrs.href ? html`data-href="${attrs.href}"` : ''} ${attrs.id ? html`data-id="${attrs.id}"` : ''}>
            ${columns.map((c) => html`<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r, i) : (r[c.key] ?? '')}</td>`)}
          </tr>`;
        })}</tbody>
        ${footer ? html`<tfoot>${footer}</tfoot>` : ''}
      </table>
    </div>`;
}

export function pager({ page, pageSize, total, label = 'records' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return html`
    <nav class="pagination" aria-label="Pagination">
      <span>Showing <b>${fmtNumber(from)}</b>–<b>${fmtNumber(to)}</b> of <b>${fmtNumber(total)}</b> ${label}</span>
      <div class="row">
        <label class="sr-only" for="page-size">Rows per page</label>
        <select id="page-size" class="select" data-page-size style="height:32px;width:auto">
          ${[10, 25, 50, 100].map((n) => html`<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} per page</option>`)}
        </select>
        <button type="button" class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft')} Previous</button>
        <span>Page ${page} of ${pages}</span>
        <button type="button" class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page">Next ${icon('chevronRight')}</button>
      </div>
    </nav>`;
}
