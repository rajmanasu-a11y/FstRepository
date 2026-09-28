import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { conflict } from '../lib/errors.js';
import { fmtDate, fmtTime, fmtDuration } from '../lib/format.js';
import { requirePermission } from '../middleware/auth.js';
import { auditContext } from '../services/audit.js';
import { getAllSettings } from '../services/settings.js';
import { getFile, readFileBuffer } from '../services/files.js';
import { getVisit, recordPrint } from '../services/visits.js';
import { maskMobile } from '../services/visitors.js';
import { createPdf, pdfToBuffer } from '../services/exporters.js';

/**
 * Server-side PDF rendition of the Half-A4 Visitor Record (two copies per A4
 * sheet) and the Visitor Pass. The browser print views are the primary print
 * path; these PDFs give a byte-exact document for archiving or e-mailing.
 */
export const printRouter = Router();

const MM = 72 / 25.4;

async function loadPrintData(visitId) {
  const visit = await getVisit(visitId);
  const settings = await getAllSettings();
  const { rows } = await query('SELECT code, config FROM print_templates');
  const templates = Object.fromEntries(rows.map((r) => [r.code, r.config]));
  const readOptional = async (fileId) => {
    if (!fileId) return null;
    try { return await readFileBuffer(await getFile(fileId)); } catch { return null; }
  };
  const photoId = visit.visitor.photoUrl?.split('/').pop();
  const [photo, logo, qr] = await Promise.all([
    readOptional(photoId),
    readOptional(settings.organisation?.logoFileId),
    QRCode.toBuffer(`${config.publicBaseUrl}/verify/${visit.qrToken}`, { errorCorrectionLevel: 'M', margin: 1, width: 300 }),
  ]);
  return { visit, settings, templates, photo, logo, qr, tz: settings.organisation?.timezone || 'UTC' };
}

function drawRecord(doc, data, top, height, copyLabel) {
  const { visit, settings, templates, photo, logo, qr, tz } = data;
  const t = templates.HALF_A4_RECORD || {};
  const org = settings.organisation || {};
  const mask = settings.security?.maskMobileInPrint !== false;
  const left = 14 * MM;
  const width = doc.page.width - 28 * MM;
  let y = top + 11 * MM;

  // Header band
  let textX = left;
  if (logo) {
    try { doc.image(logo, left, y, { fit: [34 * MM, 13 * MM] }); textX = left + 37 * MM; } catch { /* unsupported image */ }
  }
  doc.font('Bold').fontSize(13).fillColor('#12305a').text(org.name || 'Organisation', textX, y, { width: width - (textX - left) - 55 * MM });
  doc.font('Body').fontSize(8).fillColor('#475569').text('Visitor Management System', textX, doc.y + 1, { width: 90 * MM });
  if (org.address) doc.fontSize(7).text(org.address, textX, doc.y + 1, { width: width - (textX - left) - 55 * MM });
  doc.font('Bold').fontSize(12).fillColor('#0f172a').text(t.title || 'VISITOR RECORD', left + width - 55 * MM, y, { width: 55 * MM, align: 'right' });
  doc.font('Body').fontSize(7.5).fillColor('#64748b').text(copyLabel, left + width - 55 * MM, y + 16, { width: 55 * MM, align: 'right' });
  y = Math.max(doc.y, y + 16 * MM) + 2 * MM;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.2).strokeColor('#12305a').stroke();
  y += 3.5 * MM;

  // Details (left) and photo / QR (right)
  const rightW = 34 * MM;
  const detailW = width - rightW - 6 * MM;
  const labelW = 40 * MM;
  const row = (label, value) => {
    doc.font('Body').fontSize(8.5).fillColor('#64748b').text(label, left, y, { width: labelW - 2 });
    const labelBottom = doc.y;
    doc.font('Bold').fontSize(9).fillColor('#0f172a').text(value || '—', left + labelW, y, { width: detailW - labelW });
    y = Math.max(doc.y, labelBottom, y + 10) + 2.2;
  };
  const section = (title) => {
    y += 1.5;
    doc.font('Bold').fontSize(7.5).fillColor('#12305a').text(title.toUpperCase(), left, y, { characterSpacing: 0.6 });
    y = doc.y + 2;
  };
  const detailsTop = y;
  section('Visitor Information');
  row('Visitor Name', visit.visitor.fullName);
  row('Organisation / Company', visit.companyName);
  row('Designation', visit.visitor.designation);
  row('Mobile', visit.visitor.mobileNumber ? `${visit.visitor.mobileCountryCode} ${mask ? maskMobile(visit.visitor.mobileNumber) : visit.visitor.mobileNumber}` : '');
  section('Host / Officer to be Met');
  row('Whom to Meet', visit.host.name);
  row('Designation', visit.host.designation);
  row('Department', visit.departmentName);
  section('Visit Details');
  row('Purpose of Visit', visit.purpose);
  row('Visit Date', fmtDate(tz, visit.appointmentDate));
  row('Check-In', visit.checkInAt ? fmtTime(tz, visit.checkInAt) : 'Not checked in');
  row('Expected Duration', `${fmtDuration(visit.expectedDurationMin)} hrs`);
  row('Visitor Pass Number', visit.pass?.passNumber || '—');
  row('Visit Reference Number', visit.visitCode);

  // Photo & QR column
  const rx = left + width - rightW;
  let ry = detailsTop + 2;
  if (t.showPhoto !== false) {
    doc.rect(rx, ry, rightW, rightW * 4 / 3).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    if (photo) {
      try { doc.image(photo, rx + 1, ry + 1, { fit: [rightW - 2, rightW * 4 / 3 - 2], align: 'center', valign: 'center' }); } catch { /* ignore */ }
    } else {
      doc.font('Body').fontSize(7).fillColor('#94a3b8').text('No photograph', rx, ry + rightW * 2 / 3 - 4, { width: rightW, align: 'center' });
    }
    ry += rightW * 4 / 3 + 4 * MM;
  }
  if (t.showQr !== false) {
    const q = 24 * MM;
    doc.image(qr, rx + (rightW - q) / 2, ry, { width: q });
    doc.font('Body').fontSize(6.5).fillColor('#64748b').text(visit.visitCode, rx, ry + q + 2, { width: rightW, align: 'center' });
  }

  // Signatures and footer anchored to the bottom of the half page.
  const bottom = top + height - 10 * MM;
  if (t.showSignatures !== false) {
    const sy = bottom - 16 * MM;
    const half = (width - 10 * MM) / 2;
    doc.moveTo(left, sy).lineTo(left + half, sy).lineWidth(0.6).strokeColor('#475569').stroke();
    doc.moveTo(left + half + 10 * MM, sy).lineTo(left + width, sy).stroke();
    doc.font('Body').fontSize(7.5).fillColor('#475569').text('Visitor Signature', left, sy + 3, { width: half });
    doc.text('Reception / Front Desk Officer', left + half + 10 * MM, sy + 3, { width: half });
  }
  doc.moveTo(left, bottom - 5 * MM).lineTo(left + width, bottom - 5 * MM).lineWidth(0.4).strokeColor('#cbd5e1').stroke();
  doc.font('Body').fontSize(6.8).fillColor('#64748b')
    .text(org.footerText || 'This document is generated electronically by the Visitor Management System.', left, bottom - 3.5 * MM, { width, align: 'center', lineBreak: false, height: 9 });
}

// GET /api/print/visits/:id/record.pdf — two identical Half-A4 records on one A4 portrait sheet
printRouter.get('/visits/:id/record.pdf', requirePermission('pass.print'), async (req, res) => {
  const data = await loadPrintData(req.params.id);
  const t = data.templates.HALF_A4_RECORD || {};
  const copies = t.copies?.length === 2 ? t.copies : ['Office Copy', 'Visitor Copy'];
  const doc = createPdf({ size: 'A4', margin: 0, info: { Title: `Visitor Record ${data.visit.visitCode}` } });
  const half = doc.page.height / 2;
  drawRecord(doc, data, 0, half, copies[0]);
  drawRecord(doc, data, half, half, copies[1]);
  // Cutting line
  doc.save().moveTo(8 * MM, half).lineTo(doc.page.width - 8 * MM, half).dash(4, { space: 3 }).lineWidth(0.6).strokeColor('#94a3b8').stroke().restore();
  doc.font('Body').fontSize(6).fillColor('#94a3b8').text('✂  cut along this line', 0, half - 7, { width: doc.page.width, align: 'center', lineBreak: false, height: 8 });
  const pdf = await pdfToBuffer(doc);
  await recordPrint(data.visit.id, auditContext(req), 'RECORD');
  res.set('Content-Disposition', `inline; filename="visitor-record-${data.visit.visitCode}.pdf"`).type('application/pdf').send(pdf);
});

// GET /api/print/visits/:id/pass.pdf — badge sized visitor pass
printRouter.get('/visits/:id/pass.pdf', requirePermission('pass.print'), async (req, res) => {
  const data = await loadPrintData(req.params.id);
  const { visit, settings, templates, photo, logo, qr, tz } = data;
  if (!visit.pass) throw conflict('A visitor pass is issued at check-in. Please check the visitor in first.');
  const t = templates.VISITOR_PASS || {};
  const w = (t.widthMm || 90) * MM;
  const h = (t.heightMm || 60) * MM;
  const doc = createPdf({ size: [w, h], margin: 0, info: { Title: `Visitor Pass ${visit.pass.passNumber}` } });
  const color = t.headerColor || '#12305a';
  const pad = 3 * MM;
  // Header strip
  doc.rect(0, 0, w, 11 * MM).fill(color);
  if (logo) { try { doc.image(logo, pad, 1.5 * MM, { fit: [16 * MM, 8 * MM] }); } catch { /* ignore */ } }
  doc.font('Bold').fontSize(6.5).fillColor('#ffffff').text((settings.organisation?.name || '').toUpperCase(), logo ? pad + 18 * MM : pad, 2 * MM, { width: w - 45 * MM, lineBreak: false, height: 8, ellipsis: true });
  doc.font('Bold').fontSize(11).text('VISITOR PASS', w - 36 * MM, 3 * MM, { width: 33 * MM, align: 'right' });
  // Photo
  const photoW = 18 * MM;
  const top = 13 * MM;
  if (t.showPhoto !== false) {
    doc.rect(pad, top, photoW, photoW * 4 / 3).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    if (photo) { try { doc.image(photo, pad + 0.5, top + 0.5, { fit: [photoW - 1, photoW * 4 / 3 - 1] }); } catch { /* ignore */ } }
    else doc.font('Body').fontSize(5).fillColor('#94a3b8').text('No photograph', pad, top + photoW * 2 / 3 - 3, { width: photoW, align: 'center' });
  }
  const tx = t.showPhoto !== false ? pad + photoW + 2.5 * MM : pad;
  const qrW = t.showQr !== false ? 15 * MM : 0;
  const tw = w - tx - pad - qrW - 2 * MM;
  doc.font('Bold').fontSize(10).fillColor('#0f172a').text(visit.visitor.fullName, tx, top - 0.5, { width: tw, lineBreak: false, height: 12, ellipsis: true });
  doc.font('Body').fontSize(6.5).fillColor('#475569').text(visit.companyName || '', tx, doc.y + 0.5, { width: tw, lineBreak: false, height: 8, ellipsis: true });
  const line = (label, value) => {
    const y = doc.y + 1.6;
    doc.font('Body').fontSize(5.6).fillColor('#64748b').text(label.toUpperCase(), tx, y, { width: tw, lineBreak: false, height: 7 });
    doc.font('Bold').fontSize(6.8).fillColor('#0f172a').text(value || '—', tx, doc.y, { width: tw, lineBreak: false, height: 8, ellipsis: true });
  };
  line('Whom to Meet', visit.host.name);
  doc.font('Body').fontSize(6).fillColor('#334155').text(visit.host.designation || '', tx, doc.y, { width: tw, lineBreak: false, height: 8, ellipsis: true });
  line('Department', visit.departmentName);
  line('Purpose', visit.purpose);
  if (qrW) doc.image(qr, w - pad - qrW, top, { width: qrW });
  // Bottom row
  const by = h - 15 * MM;
  doc.moveTo(pad, by).lineTo(w - pad, by).lineWidth(0.4).strokeColor('#cbd5e1').stroke();
  const cols = [['Date', fmtDate(tz, visit.checkInAt || visit.appointmentDate)], ['Check-In', fmtTime(tz, visit.checkInAt)], ['Valid Until', fmtTime(tz, visit.validUntil)], ['Pass No.', visit.pass.passNumber]];
  const shares = [0.22, 0.19, 0.21, 0.38];
  let cx = pad;
  cols.forEach(([l, v], i) => {
    const cw = (w - 2 * pad) * shares[i];
    doc.font('Body').fontSize(5.4).fillColor('#64748b').text(l.toUpperCase(), cx, by + 1.2 * MM, { width: cw, lineBreak: false, height: 7 });
    doc.font('Bold').fontSize(i === 3 ? 6.6 : 7).fillColor('#0f172a').text(v, cx, by + 4 * MM, { width: cw, lineBreak: false, height: 9 });
    cx += cw;
  });
  doc.font('Body').fontSize(4.8).fillColor('#475569').text(t.instruction || '', pad, h - 6.5 * MM, { width: w - 2 * pad, align: 'center', height: 14 });
  const pdf = await pdfToBuffer(doc);
  await recordPrint(visit.id, auditContext(req), 'PASS');
  res.set('Content-Disposition', `inline; filename="visitor-pass-${visit.pass.passNumber}.pdf"`).type('application/pdf').send(pdf);
});
