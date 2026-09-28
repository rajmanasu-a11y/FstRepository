import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { login } from './helpers.js';

const MM = 96 / 25.4; // CSS pixels per millimetre

async function checkedInVisit(page) {
  return page.evaluate(async () => {
    const r = await (await fetch('/api/visits/lookup?mode=checkout&q=')).json();
    return r.items.find((v) => v.visitor.photoUrl) || r.items[0];
  });
}

const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const mediaBox = (buf) => /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(buf.toString('latin1')).slice(1).map(Number);

async function decodeQr(locator) {
  // The sticky preview toolbar would overlap the element once it is scrolled into view.
  await locator.page().evaluate(() => { document.querySelector('.print-toolbar').style.display = 'none'; });
  const png = PNG.sync.read(await locator.screenshot({ scale: 'device' }));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code?.data || null;
}

test.use({ deviceScaleFactor: 3 });

test('Half-A4 record: A4 portrait, two copies per sheet, no clipping, correct data, readable QR', async ({ page }) => {
  await login(page, 'reception');
  const v = await checkedInVisit(page);
  await page.goto(`/print/record/${v.id}`);
  const records = page.locator('.record');
  await expect(records).toHaveCount(2);
  await expect(page.locator('.print-toolbar [data-print]')).toBeFocused();

  // Geometry: the sheet is 210 × 297 mm and each record is exactly half of it.
  const sheet = await page.locator('.sheet').boundingBox();
  expect(Math.round(sheet.width / MM)).toBe(210);
  expect(Math.round(sheet.height / MM)).toBe(297);
  for (const r of await records.all()) {
    const box = await r.boundingBox();
    expect(Math.abs(box.height / MM - 148.5)).toBeLessThan(0.6);
    // Nothing inside overflows or is clipped.
    const overflow = await r.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(0);
    const clipped = await r.evaluate((el) => {
      const rb = el.getBoundingClientRect();
      return [...el.querySelectorAll('*')].filter((c) => {
        const b = c.getBoundingClientRect();
        return b.height > 0 && (b.bottom > rb.bottom + 0.5 || b.right > rb.right + 0.5 || b.left < rb.left - 0.5);
      }).length;
    });
    expect(clipped).toBe(0);
  }
  const cut = await page.locator('.cut-line').boundingBox();
  expect(Math.abs((cut.y - sheet.y) / MM - 148.5)).toBeLessThan(0.6);

  // Content: visitor, host, check-in time, pass & reference numbers, masked mobile.
  const first = records.first();
  for (const text of [v.visitor.fullName, v.host.name, v.host.designation, v.departmentName, v.visitCode, v.pass.passNumber, 'Visitor Signature', 'Reception / Front Desk Officer', 'Office Copy']) {
    await expect(first).toContainText(text);
  }
  await expect(records.nth(1)).toContainText('Visitor Copy');
  const checkIn = await page.evaluate((iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)).toUpperCase(), v.checkInAt);
  await expect(first).toContainText(checkIn);
  await expect(first).toContainText(/XXXXXXXX\d\d/);

  // Photo and QR positioned in the right column inside the record.
  const photo = first.locator('.rec-photo img');
  await expect(photo).toHaveJSProperty('complete', true);
  expect(await photo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  const recBox = await first.boundingBox();
  const photoBox = await first.locator('.rec-photo').boundingBox();
  expect(photoBox.x).toBeGreaterThan(recBox.x + recBox.width / 2);
  const qrData = await decodeQr(first.locator('.rec-qr img'));
  expect(qrData).toBe(`http://127.0.0.1:3100/verify/${v.qrToken}`);

  // Printed output: exactly one A4 page.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-toolbar')).toBeHidden();
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(pdf)).toBe(1);
  const [w, h] = mediaBox(pdf);
  expect(Math.round(w)).toBe(595);
  expect(Math.round(h)).toBe(842);
});

test('Visitor pass: 90 × 60 mm badge on one page, readable QR, photo and logo area, no overflow', async ({ page }) => {
  await login(page, 'reception');
  const v = await checkedInVisit(page);
  await page.goto(`/print/pass/${v.id}`);
  const pass = page.locator('.pass');
  const box = await pass.boundingBox();
  expect(Math.round(box.width / MM)).toBe(90);
  expect(Math.round(box.height / MM)).toBe(60);
  for (const t of ['VISITOR PASS', v.visitor.fullName, v.host.name, v.pass.passNumber, 'returned at the time of departure']) await expect(pass).toContainText(t);
  const overflowing = await pass.evaluate((el) => {
    const pb = el.getBoundingClientRect();
    return [...el.querySelectorAll('*')].filter((c) => { const b = c.getBoundingClientRect(); return b.height > 0 && (b.bottom > pb.bottom + 0.5 || b.right > pb.right + 0.5); }).map((c) => c.className);
  });
  expect(overflowing).toEqual([]);
  expect(await decodeQr(pass.locator('.pass-qr img'))).toBe(`http://127.0.0.1:3100/verify/${v.qrToken}`);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(pdf)).toBe(1);
  const [w, h] = mediaBox(pdf);
  expect(Math.round(w / 72 * 25.4)).toBe(90);
  expect(Math.round(h / 72 * 25.4)).toBe(60);
});

test('Server-side PDF downloads for the record and the pass', async ({ page }) => {
  await login(page, 'reception');
  const v = await checkedInVisit(page);
  const record = await page.request.get(`/api/print/visits/${v.id}/record.pdf`);
  expect(record.headers()['content-type']).toBe('application/pdf');
  const buf = Buffer.from(await record.body());
  expect(pdfPages(buf)).toBe(1);
  const pass = await page.request.get(`/api/print/visits/${v.id}/pass.pdf`);
  expect(pdfPages(Buffer.from(await pass.body()))).toBe(1);
});

test('Reports and the on-premises list print on A4 landscape without application chrome', async ({ page, context }) => {
  await login(page, 'superadmin', '/reports/daily');
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('[data-print]')]);
  await expect(popup.locator('table.rd tbody tr').first()).toBeVisible();
  await expect(popup.locator('.rd-head')).toContainText('Daily Visitor Report');
  await popup.emulateMedia({ media: 'print' });
  await expect(popup.locator('.print-toolbar')).toBeHidden();
  const pdf = await popup.pdf({ preferCSSPageSize: true });
  const [w, h] = mediaBox(pdf);
  expect(w).toBeGreaterThan(h);
  await popup.close();

  await page.goto('/on-premises');
  const [op] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'PRINT CURRENT ON-PREMISES LIST' }).click()]);
  await expect(op.locator('.rd-head')).toContainText('Visitors Currently On Premises');
  const rows = await op.locator('table.rd tbody tr').count();
  const count = await page.locator('[data-total]').textContent();
  expect(rows).toBe(Number(count));
});

test('Emergency roll call prints immediately with every person on premises', async ({ page, context }) => {
  await login(page, 'security', '/emergency');
  await expect(page.locator('[data-print]')).toBeFocused();
  const count = Number(await page.locator('[data-count]').textContent());
  expect(count).toBeGreaterThan(0);
  const [doc] = await Promise.all([context.waitForEvent('page'), page.click('[data-print]')]);
  await expect(doc.locator('.banner')).toContainText('EMERGENCY VISITOR ACCOUNTABILITY');
  expect(await doc.locator('table.rd tbody tr').count()).toBe(count);
  await expect(doc.locator('.rd-group').first()).toBeVisible();
  await doc.emulateMedia({ media: 'print' });
  const pdf = await doc.pdf({ preferCSSPageSize: true });
  expect(pdfPages(pdf)).toBeGreaterThanOrEqual(1);
});
