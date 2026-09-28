import { test, expect } from '@playwright/test';
import { login, watchErrors } from './helpers.js';

test('loading states are shown while searching', async ({ page }) => {
  await login(page, 'reception', '/register');
  await expect(page.locator('#vs-query')).toBeFocused();
  await page.route('**/api/visitors/search**', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await page.keyboard.type('ramesh');
  await expect(page.locator('#vs-results')).toContainText('Searching visitor records…');
  await expect(page.locator('.visitor-match').first()).toBeVisible();
});

test('empty states are professional and helpful', async ({ page }) => {
  await login(page, 'reception', '/visitors');
  await page.fill('#f-q', 'no-such-visitor-zzz');
  await page.click('[data-filters] button[type=submit]');
  await expect(page.locator('.empty-title')).toHaveText('No visitors found');
  await expect(page.locator('.empty-hint')).toHaveText('Try changing the search criteria or date range.');
  await page.goto('/register');
  await expect(page.locator('#vs-query')).toBeFocused();
  await page.keyboard.type('qqqzzzxxx');
  await page.keyboard.press('Enter');
  await expect(page.locator('#vs-results')).toContainText('No existing visitor found');
});

test('unsaved registrations are protected: leave guard and draft recovery', async ({ page }) => {
  await login(page, 'reception', '/register');
  await page.click('#vs-new');
  await page.fill('#v-name', 'Draft Person');
  await page.fill('#v-mobile', '9811100022');
  await page.fill('#v-idnumber', 'SECRET123');
  await page.waitForTimeout(600); // draft save is debounced
  // In-app navigation asks for confirmation.
  await page.click('#main-nav >> text=Dashboard');
  const dialog = page.locator('[role=dialog]');
  await expect(dialog).toContainText('Unsaved information');
  await dialog.getByRole('button', { name: 'Stay on this screen' }).click();
  await expect(page.locator('h1')).toHaveText('Visitor Registration');
  await expect(page.locator('#v-name')).toHaveValue('Draft Person');
  // Browser refresh: the draft is recovered (the ID number is never stored).
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.locator('[data-draft-banner]')).toContainText('Unsaved registration recovered');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('#v-name')).toHaveValue('Draft Person');
  await expect(page.locator('#v-mobile')).toHaveValue('9811100022');
  await expect(page.locator('#v-idnumber')).toHaveValue('');
  const stored = await page.evaluate(() => sessionStorage.getItem('vms.registrationDraft'));
  expect(stored).not.toContain('SECRET123');
});

test('inline validation is associated with each field', async ({ page }) => {
  await login(page, 'reception', '/register');
  await page.click('#vs-new');
  await page.fill('#v-name', '12345');
  await page.fill('#v-mobile', '12345');
  await page.fill('#v-email', 'bad@');
  await page.click('#btn-save');
  await expect(page.locator('#v-name-error')).toHaveText('Full Name must contain letters only (numbers are not allowed)');
  await expect(page.locator('#v-mobile-error')).toContainText('valid 10-digit Indian mobile number');
  await expect(page.locator('#v-email-error')).toHaveText('Enter a valid email address');
  await expect(page.locator('#t-host-error')).toHaveText('Host / Officer to be Met is required');
  await expect(page.locator('#t-purpose-error')).toHaveText('Purpose of Visit is required');
  const describedBy = await page.locator('#v-name').getAttribute('aria-describedby');
  expect(describedBy).toContain('v-name-error');
  await expect(page.locator('#v-name')).toBeFocused();
});

test('reports: filter, sort, paginate, choose columns, export and print', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'superadmin', '/reports/date-wise');
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  await page.selectOption('#r-period', 'year');
  await page.selectOption('#r-dept', { label: 'Finance' });
  await page.click('[data-filters] button[type=submit]');
  await expect(page.locator('[data-range-hint]')).toContainText('to');
  const rows = page.locator('table.data tbody tr');
  await expect(rows.first()).toBeVisible();
  await page.click('[data-sort="visitor"]');
  await expect(page.locator('th[aria-sort]')).toHaveAttribute('aria-sort', /descending|ascending/);
  await page.click('[data-cols]');
  await page.locator('[data-col-menu] label', { hasText: 'Department' }).locator('input').check();
  await expect(page.locator('table.data thead')).toContainText('Department');
  const deptCells = await page.locator('table.data tbody tr td:nth-child(6)').allTextContents();
  expect(deptCells.length).toBeGreaterThan(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="xlsx"]')]);
  expect(download.suggestedFilename()).toMatch(/^date-wise-report-.*\.xlsx$/);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="pdf"]')]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await page.click('[data-reset]');
  await expect(page.locator('#r-dept')).toHaveValue('');
  await page.goto('/reports/host-wise');
  await expect(page.locator('table.data tfoot')).toContainText('Total');
  expect(errors).toEqual([]);
});

test('dashboard shows the summary cards, live status and charts', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'admin');
  for (const label of ['Total Visitors Today', 'Currently Inside', 'Checked Out', 'Expected Visitors', 'Pending Approvals', 'Repeat Visitors', 'First-Time Visitors', 'Restricted / Flagged']) {
    await expect(page.locator('.stats')).toContainText(label);
  }
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  await expect(page.locator('.charts .card')).toHaveCount(7);
  await page.getByRole('button', { name: 'This Month' }).click();
  await expect(page.getByRole('button', { name: 'This Month' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#live-filter').selectOption('OVERSTAY');
  await expect(page.locator('table.data tbody tr').first()).toContainText('Overstay');
  expect(errors).toEqual([]);
});
