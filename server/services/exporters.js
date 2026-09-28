import fs from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatCell, fmtDateTime, fmtDate } from '../lib/format.js';

// ---------------------------------------------------------------------------
// Fonts: a Unicode TrueType font is used when available so that names in any
// script render correctly; otherwise PDFKit's built-in Helvetica is used.
// ---------------------------------------------------------------------------
const FONT_CANDIDATES = [
  [process.env.PDF_FONT_PATH, process.env.PDF_FONT_BOLD_PATH],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
];
let fontPair;
function fonts() {
  if (fontPair !== undefined) return fontPair;
  fontPair = null;
  for (const [regular, bold] of FONT_CANDIDATES) {
    if (regular && fs.existsSync(regular)) {
      fontPair = { regular, bold: bold && fs.existsSync(bold) ? bold : regular };
      break;
    }
  }
  return fontPair;
}

export function createPdf(options) {
  const doc = new PDFDocument({ bufferPages: true, ...options });
  const f = fonts();
  if (f) {
    doc.registerFont('Body', f.regular);
    doc.registerFont('Bold', f.bold);
  } else {
    doc.registerFont('Body', 'Helvetica');
    doc.registerFont('Bold', 'Helvetica-Bold');
  }
  doc.font('Body');
  return doc;
}

export function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function describeFilters(meta) {
  const parts = [];
  if (meta.filters.from || meta.filters.to) parts.push(`Period: ${fmtDate(meta.tz, meta.filters.from)} to ${fmtDate(meta.tz, meta.filters.to)}`);
  for (const [label, value] of meta.filterLabels || []) if (value) parts.push(`${label}: ${value}`);
  return parts.join('   |   ') || 'All records';
}

function visibleColumns(columns, visibleKeys) {
  if (!visibleKeys?.length) return columns.filter((c) => c.visible !== false);
  const set = new Set(visibleKeys);
  const cols = columns.filter((c) => set.has(c.key));
  return cols.length ? cols : columns.filter((c) => c.visible !== false);
}

function cellValue(meta, col, row) {
  if (col.key === 'status' && row.status) return formatCell(meta.tz, 'status', row.status);
  return formatCell(meta.tz, col.type, row[col.key]);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export function toCsv(meta, columns, rows) {
  const cols = visibleColumns(columns, meta.visibleKeys);
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [cols.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(cellValue(meta, c, r))).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export async function toXlsx(meta, columns, rows) {
  const cols = visibleColumns(columns, meta.visibleKeys);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Visitor Management System';
  wb.created = new Date();
  const ws = wb.addWorksheet(meta.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 6 }], pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const lastCol = Math.max(cols.length, 1);
  const titleRows = [
    [meta.organisation.name, { bold: true, size: 14 }],
    [meta.title, { bold: true, size: 12 }],
    [describeFilters(meta), { size: 10, color: { argb: 'FF475569' } }],
    [`Generated on ${fmtDateTime(meta.tz, new Date())} by ${meta.generatedBy}   |   Records: ${rows.length}`, { size: 9, color: { argb: 'FF64748B' } }],
  ];
  titleRows.forEach(([text, font], i) => {
    ws.mergeCells(i + 1, 1, i + 1, lastCol);
    const cell = ws.getCell(i + 1, 1);
    cell.value = text;
    cell.font = font;
  });
  const header = ws.getRow(6);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12305A' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });
  header.height = 22;
  rows.forEach((r, ri) => {
    const row = ws.getRow(7 + ri);
    cols.forEach((c, ci) => {
      const v = cellValue(meta, c, r);
      row.getCell(ci + 1).value = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
    });
    if (ri % 2 === 1) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; });
  });
  if (meta.totals) {
    const row = ws.getRow(7 + rows.length);
    cols.forEach((c, ci) => {
      if (ci === 0) row.getCell(1).value = 'Total';
      else if (meta.totals[c.key] !== undefined) row.getCell(ci + 1).value = cellValue(meta, c, meta.totals);
    });
    row.font = { bold: true };
  }
  cols.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...rows.slice(0, 500).map((r) => String(cellValue(meta, c, r) ?? '').length));
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), 48);
  });
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: lastCol } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// PDF (A4 landscape, repeating table header, page numbers)
// ---------------------------------------------------------------------------
export async function toPdf(meta, columns, rows) {
  const cols = visibleColumns(columns, meta.visibleKeys);
  const doc = createPdf({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 40, left: 32, right: 32 }, info: { Title: meta.title, Author: meta.organisation.name } });
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 16;
  const fontSize = cols.length > 12 ? 7 : 8;

  // Column widths proportional to content length (bounded).
  const sample = rows.slice(0, 300);
  const weights = cols.map((c) => {
    const len = Math.max(c.label.length * 0.9, ...sample.map((r) => String(cellValue(meta, c, r) ?? '').length));
    return Math.min(Math.max(len, c.key === 'slNo' ? 4 : 6), 36);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * pageWidth);

  const drawHeaderBlock = () => {
    doc.font('Bold').fontSize(13).fillColor('#12305a').text(meta.organisation.name || 'Visitor Management System', left, doc.page.margins.top, { width: pageWidth });
    if (meta.organisation.address) doc.font('Body').fontSize(8).fillColor('#475569').text(meta.organisation.address, { width: pageWidth });
    doc.moveDown(0.3);
    doc.font('Bold').fontSize(11).fillColor('#0f172a').text(meta.title.toUpperCase(), { width: pageWidth });
    doc.font('Body').fontSize(8).fillColor('#475569').text(describeFilters(meta), { width: pageWidth });
    doc.text(`Generated on ${fmtDateTime(meta.tz, new Date())} by ${meta.generatedBy}   |   Total records: ${meta.total ?? rows.length}${meta.total > rows.length ? ` (first ${rows.length} included)` : ''}`, { width: pageWidth });
    doc.moveDown(0.5);
  };
  const drawTableHeader = () => {
    const y = doc.y;
    doc.font('Bold').fontSize(fontSize);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - 6 }))) + 8;
    doc.rect(left, y, pageWidth, h).fill('#12305a');
    let x = left;
    cols.forEach((c, i) => {
      doc.fillColor('#ffffff').text(c.label, x + 3, y + 4, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.y = y + h;
    doc.font('Body').fillColor('#0f172a');
  };

  drawHeaderBlock();
  drawTableHeader();
  if (!rows.length) {
    doc.moveDown(1).font('Body').fontSize(10).fillColor('#475569').text('No records found for the selected criteria.', left, doc.y, { width: pageWidth, align: 'center' });
  }
  const allRows = meta.totals ? [...rows, { __total: true, ...meta.totals }] : rows;
  allRows.forEach((r, ri) => {
    doc.font(r.__total ? 'Bold' : 'Body').fontSize(fontSize);
    const values = cols.map((c, i) => (r.__total && i === 0 ? 'Total' : r.__total && meta.totals[c.key] === undefined ? '' : String(cellValue(meta, c, r) ?? '')));
    const h = Math.max(...values.map((v, i) => doc.heightOfString(v || ' ', { width: widths[i] - 6 }))) + 6;
    if (doc.y + h > bottomLimit()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawTableHeader();
      doc.font(r.__total ? 'Bold' : 'Body').fontSize(fontSize);
    }
    const y = doc.y;
    if (ri % 2 === 1) doc.rect(left, y, pageWidth, h).fill('#f1f5f9');
    let x = left;
    values.forEach((v, i) => {
      doc.fillColor('#0f172a').text(v, x + 3, y + 3, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + pageWidth, y + h).lineWidth(0.4).strokeColor('#cbd5e1').stroke();
    doc.y = y + h;
  });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    doc.font('Body').fontSize(7).fillColor('#64748b');
    doc.text(meta.organisation.footerText || 'Generated by the Visitor Management System.', left, y, { width: pageWidth * 0.7, lineBreak: false, height: 10 });
    doc.text(`Page ${i + 1} of ${range.count}`, left + pageWidth * 0.7, y, { width: pageWidth * 0.3, align: 'right', lineBreak: false, height: 10 });
  }
  return pdfToBuffer(doc);
}
