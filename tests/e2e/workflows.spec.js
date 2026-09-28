import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { login, watchErrors, PASSWORD } from './helpers.js';

const todayDDMMYYYY = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('day')}-${g('month')}-${g('year')}`;
};

test('New visitor: registration → host → photo → check-in → pass → on premises → check-out → history → reports → Half-A4 → audit', async ({ page, context }) => {
  const errors = watchErrors(page);
  await login(page, 'reception', '/register');

  // Registration with a first-time visitor and a new organisation.
  await page.click('#vs-new');
  await page.fill('#v-name', 'Harini Venkataraman');
  await page.fill('#v-mobile', '9811122233');
  await page.locator('#v-mobile').blur();
  await expect(page.locator('[data-duplicate]')).toBeEmpty();
  await page.fill('#v-email', 'harini@northwind.example');
  await page.fill('#v-company', 'Northwind Traders India');
  await page.locator('.combo:has(#v-company) .create-row').click();
  await expect(page.locator('[data-company-help]')).toContainText('will be added to the organisation directory');
  await page.fill('#v-designation', 'Managing Director');
  await page.selectOption('#v-idtype', { label: 'Passport' });
  await page.fill('#v-idnumber', 'Z1234567');
  await page.check('#v-idverified');

  // Photograph upload is validated, resized and shown in the frame.
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#9db4d0' } }).jpeg().toBuffer();
  await page.setInputFiles('#photo-file', { name: 'harini.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.locator('[data-photo-frame] img')).toBeVisible();
  await expect(page.locator('#btn-photo-remove')).toBeVisible();

  // Host selection shows designation and department automatically.
  await page.fill('#t-host', 'Anil');
  await page.locator('.combo:has(#t-host) [role=option]', { hasText: 'Anil Mehta' }).click();
  await expect(page.locator('[data-host-card]')).toContainText('Chief Financial Officer · Finance Department');
  await expect(page.locator('#t-dept option:checked')).toHaveText('Finance');
  await page.selectOption('#t-purpose', { label: 'Audit' });
  await page.selectOption('#t-category', { label: 'Business Visitor' });
  await page.fill('#t-vehicle', 'ka05 mn 1234');
  await page.selectOption('#t-vehicle-type', 'CAR');
  await page.check('#t-parking');
  await page.selectOption('#t-area', { label: 'Conference Room' });
  await page.check('#t-consent');
  await page.click('#btn-checkin');
  const result = page.locator('[data-result]');
  await expect(result).toContainText('Visitor successfully checked in.');
  const passNumber = (await result.locator('b.mono').nth(1).textContent()).trim();
  const visitCode = (await result.locator('b.mono').first().textContent()).trim();
  expect(passNumber).toMatch(/^PASS-\d{4}-\d{6}$/);
  expect(visitCode).toMatch(/^VST-\d{4}-\d{6}$/);
  await expect(page.locator('#btn-print-pass')).toBeFocused();

  // Visitor pass print preview.
  const [pass] = await Promise.all([context.waitForEvent('page'), page.click('#btn-print-pass')]);
  await expect(pass.locator('.pass')).toContainText('Harini Venkataraman');
  await expect(pass.locator('.pass')).toContainText('Northwind Traders India');
  await expect(pass.locator('.pass')).toContainText('Mr. Anil Mehta');
  await expect(pass.locator('.pass')).toContainText('Chief Financial Officer');
  await expect(pass.locator('.pass')).toContainText(passNumber);
  await expect(pass.locator('.pass-photo img')).toHaveJSProperty('complete', true);
  // Pressing Print records the print in the audit log (window.print is a no-op in headless mode).
  await Promise.all([pass.waitForResponse((r) => r.url().includes('/print') && r.request().method() === 'POST'), pass.click('[data-print]')]);
  await pass.close();

  // Half-A4 record: two identical copies.
  const [rec] = await Promise.all([context.waitForEvent('page'), page.click('#btn-print-record')]);
  await expect(rec.locator('.record')).toHaveCount(2);
  await expect(rec.locator('.record').first()).toContainText('Harini Venkataraman');
  await expect(rec.locator('.record').nth(1)).toContainText(visitCode);
  await expect(rec.locator('.record').first()).toContainText(todayDDMMYYYY());
  await expect(rec.locator('.record').first()).toContainText('+91 XXXXXXXX33');
  await rec.close();

  // Visitor appears on premises.
  await page.goto('/on-premises');
  await expect(page.locator('table.data')).toContainText('Harini Venkataraman');
  await expect(page.locator('table.data')).toContainText(passNumber);

  // Check-out by pass number.
  await page.goto('/check-out');
  await page.fill('#co-q', passNumber);
  await expect(page.locator('[data-detail]')).toContainText('Harini Venkataraman');
  await page.click('[data-do-checkout]');
  await expect(page.locator('[data-detail]')).toContainText('Visitor check-out has been recorded successfully.');
  await expect(page.locator('[data-detail] .big-duration')).toHaveText(/^\d\d:\d\d$/);

  // Visit history & visitor profile.
  await page.goto('/visitors');
  await page.fill('#f-q', 'Harini');
  await page.click('[data-filters] button[type=submit]');
  const row = page.locator('table.data tbody tr', { hasText: 'Harini Venkataraman' });
  await expect(row).toContainText('Checked-Out');
  await row.click();
  await expect(page.locator('h1')).toContainText('Harini Venkataraman');
  await expect(page.locator('.timeline')).toContainText('Checked in – visitor pass issued');
  await expect(page.locator('.timeline')).toContainText('Visit record closed');
  await page.click('text=Visitor Profile');
  await expect(page.locator('h1')).toContainText('HARINI VENKATARAMAN');
  await expect(page.locator('[data-history] tbody tr')).toHaveCount(1);

  // Reports and audit trail (super administrator).
  await page.goto('/');
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': 'x' } }); });
  await page.context().clearCookies();
  await login(page, 'superadmin', '/reports/daily');
  await expect(page.locator('table.data')).toContainText('Harini Venkataraman');
  await page.goto('/audit');
  await page.fill('#a-q', visitCode);
  await page.click('[data-f] button[type=submit]');
  await expect(page.locator('table.data')).toContainText('VISITOR CHECKED IN');
  await expect(page.locator('table.data')).toContainText('VISITOR CHECKED OUT');
  await expect(page.locator('table.data')).toContainText('VISITOR PASS PRINTED');
  expect(errors).toEqual([]);
});

test('Returning visitor: mobile search → Existing Visitor Found → reuse → update visit → check-in → print', async ({ page, context, request }) => {
  const errors = watchErrors(page);
  await login(page, 'reception', '/register');
  const before = await page.evaluate(async () => (await (await fetch('/api/visitors/search?q=9876543210')).json()).items[0].totalVisits);

  await page.keyboard.type('9876543210');
  const card = page.locator('.visitor-match.best');
  await expect(card).toContainText('Existing Visitor Found');
  await expect(card).toContainText('RAMESH KUMAR');
  await expect(card).toContainText('ABC Technologies Pvt. Ltd.');
  await expect(card).toContainText('Last Visit:');
  await expect(card).toContainText(`Total Visits:${before}`.replace(':', ':'));
  await expect(card).toContainText('Mr. Rajesh Kumar, Manager – Administration');
  await expect(card).toContainText('Official Meeting');
  await card.getByRole('button', { name: 'Use Existing Details' }).click();

  // Visitor details are populated; visit details are pre-filled from the last visit.
  await expect(page.locator('#v-name')).toHaveValue('Ramesh Kumar');
  await expect(page.locator('#v-company')).toHaveValue('ABC Technologies Pvt. Ltd.');
  await expect(page.locator('#v-designation')).toHaveValue('General Manager');
  await expect(page.locator('[data-existing-banner]')).toContainText('Existing visitor VIS-000001');
  await expect(page.locator('#t-host')).toHaveValue('Mr. Rajesh Kumar');
  await expect(page.locator('#t-host')).toBeFocused();

  // Update only what changes for this visit.
  await page.selectOption('#t-purpose', { label: 'Document Submission' });
  await page.selectOption('#t-duration', '30');
  await page.fill('#t-vehicle', 'KA01MJ4521');
  await page.check('#t-consent');
  await page.click('#btn-checkin');
  await expect(page.locator('[data-result]')).toContainText('Visitor successfully checked in.');

  const after = await page.evaluate(async () => (await (await fetch('/api/visitors/search?q=9876543210')).json()));
  expect(after.total).toBe(1);
  expect(after.items[0].totalVisits).toBe(before + 1);
  expect(after.items[0].lastVisit.purpose).toBe('Document Submission');

  const [pass] = await Promise.all([context.waitForEvent('page'), page.click('#btn-print-pass')]);
  await expect(pass.locator('.pass')).toContainText('Ramesh Kumar');
  await expect(pass.locator('.pass')).toContainText('Document Submission');
  await pass.close();
  expect(errors).toEqual([]);
});

test('Duplicate detection offers the existing visitor instead of creating a new record', async ({ page }) => {
  await login(page, 'reception', '/register');
  await page.click('#vs-new');
  await page.fill('#v-name', 'Another Person');
  await page.fill('#v-mobile', '9845012345');
  await page.locator('#v-mobile').blur();
  const dup = page.locator('[data-duplicate]');
  await expect(dup).toContainText('Existing Visitor Found');
  await expect(dup).toContainText('Sneha Kulkarni');
  await dup.getByRole('button', { name: 'Use Existing Visitor' }).click();
  await expect(page.locator('#v-name')).toHaveValue('Sneha Kulkarni');
  await expect(page.locator('[data-existing-banner]')).toContainText('Existing visitor');
});

test('Pre-registration by a host → QR invitation → reception checks in by scanning the QR code', async ({ page, context }) => {
  await login(page, 'rajesh.kumar', '/pre-registration');
  await page.fill('#p-name', 'Scan Test Visitor');
  await page.fill('#p-mobile', '9822233344');
  await page.selectOption('#p-purpose', { label: 'Business Meeting' });
  await page.fill('#p-date', await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())));
  await page.fill('#p-arrival', '23:30');
  await page.click('[data-submit]');
  const result = page.locator('[data-result]');
  await expect(result).toContainText('Pre-registration completed successfully.');
  const code = (await result.locator('b.mono').textContent()).trim();
  await expect(result.locator('.qr-box img')).toBeVisible();
  const [inv] = await Promise.all([context.waitForEvent('page'), page.click('[data-invite]')]);
  await expect(inv.locator('.record').first()).toContainText('VISIT INVITATION');
  await expect(inv.locator('.record').first()).toContainText(code);
  await inv.close();

  const token = await page.evaluate(async (c) => (await (await fetch(`/api/visits/${c}`)).json()).visit.qrToken, code);
  await page.context().clearCookies();
  await login(page, 'reception', '/check-in');
  // A USB scanner "types" the QR content followed by Enter.
  await page.keyboard.type(`http://127.0.0.1:3100/verify/${token}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-detail]')).toContainText('Scan Test Visitor');
  await page.check('#ci-consent');
  await page.click('[data-do-checkin]');
  await expect(page.locator('[data-detail]')).toContainText('Visitor successfully checked in.');
});

test('Host approval workflow for a restricted area', async ({ page }) => {
  await login(page, 'reception', '/register');
  await page.click('#vs-new');
  await page.fill('#v-name', 'Server Room Engineer');
  await page.fill('#v-mobile', '9833344455');
  await page.fill('#v-company', 'Zenith');
  await page.locator('.combo:has(#v-company) [role=option]', { hasText: 'Zenith Systems Integrators' }).click();
  await page.fill('#t-host', 'Arjun');
  await page.locator('.combo:has(#t-host) [role=option]', { hasText: 'Arjun Reddy' }).click();
  await page.selectOption('#t-purpose', { label: 'Service / Maintenance' });
  await page.selectOption('#t-area', { label: 'Server Room (restricted)' });
  await page.check('#t-consent');
  await page.click('#btn-checkin');
  await expect(page.locator('[data-result]')).toContainText('The host has been asked to approve this visit');
  await expect(page.locator('#btn-checkin')).toBeDisabled();

  await page.context().clearCookies();
  await login(page, 'superadmin', '/approvals');
  const item = page.locator('article', { hasText: 'Server Room Engineer' });
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('article', { hasText: 'Server Room Engineer' })).toHaveCount(0);
});
