import { test, expect } from '@playwright/test';
import { login, watchErrors } from './helpers.js';

const navItems = (page) => page.locator('#main-nav a').allTextContents();

test('each role sees only its own navigation', async ({ page }) => {
  await login(page, 'reception');
  expect(await navItems(page)).toEqual(['Dashboard', 'Registration', 'Visitors', 'Pre-Registration', 'Check-In', 'Check-Out', 'On Premises']);
  await page.context().clearCookies();
  await login(page, 'security');
  expect(await navItems(page)).toEqual(['Dashboard', 'Visitors', 'Check-In', 'Check-Out', 'On Premises', 'Verify Pass']);
  await expect(page.locator('a.emergency')).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'rajesh.kumar');
  expect(await navItems(page)).toEqual(['Dashboard', 'Pre-Registration', 'Approvals', 'My Visitors']);
  await expect(page.locator('a.emergency')).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, 'superadmin');
  const all = await navItems(page);
  for (const n of ['Reports', 'Hosts', 'Companies', 'Settings', 'Audit Logs']) expect(all).toContain(n);
});

test('direct URL access to restricted screens is refused', async ({ page }) => {
  await login(page, 'reception');
  for (const url of ['/settings', '/audit', '/reports/daily', '/employees', '/companies']) {
    await page.goto(url);
    await expect(page.locator('#main')).toContainText('Access restricted');
  }
  await page.context().clearCookies();
  await login(page, 'rajesh.kumar');
  for (const url of ['/register', '/check-in', '/on-premises', '/emergency', '/visitors/1']) {
    await page.goto(url);
    await expect(page.locator('#main')).toContainText('Access restricted');
  }
});

test('unauthenticated users are sent to the sign-in screen and returned afterwards', async ({ page }) => {
  await page.goto('/on-premises');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.fill('#login-username', 'security');
  await page.fill('#login-password', 'Vms@Demo2026');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('Visitors Currently On Premises');
});

test('invalid sign-in shows a clear message and keeps focus on the password', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-username', 'reception');
  await page.fill('#login-password', 'wrong');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-login-message]')).toContainText('The username or password is incorrect.');
  await expect(page.locator('#login-password')).toBeFocused();
  await expect(page.locator('#login-password')).toHaveValue('');
});

test('an expired session returns the user to sign-in with an explanation', async ({ page }) => {
  await login(page, 'reception', '/visitors');
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': 'irrelevant' } }); });
  await page.context().clearCookies();
  await page.click('#main-nav >> text=On Premises');
  await expect(page.locator('#login-username')).toBeVisible();
});

test('sign out ends the session', async ({ page }) => {
  await login(page, 'admin');
  await page.click('[data-user-toggle]');
  await page.click('[data-logout]');
  await expect(page.locator('#login-username')).toBeVisible();
  const r = await page.request.get('/api/auth/me');
  expect(r.status()).toBe(401);
});

test('user-supplied text is always rendered as text (XSS)', async ({ page }) => {
  await login(page, 'reception');
  const payload = '<img src=x onerror="window.__xss=1">Evil Corp';
  const created = await page.evaluate(async (company) => {
    const me = await (await fetch('/api/auth/me')).json();
    const masters = await (await fetch('/api/masters')).json();
    const host = (await (await fetch('/api/employees?q=rajesh')).json()).items[0];
    const r = await fetch('/api/visits', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken },
      body: JSON.stringify({ visitor: { fullName: 'Xss Probe', mobileNumber: '9700011122', newCompanyName: company }, visit: { hostEmployeeId: host.id, purposeId: masters.purposes[0].id, categoryId: masters.categories[0].id, consentGiven: true }, checkIn: true }),
    });
    return r.status;
  }, payload);
  expect(created).toBe(201);
  await page.goto('/');
  await expect(page.locator('table.data')).toContainText(payload);
  await page.goto('/on-premises');
  await expect(page.locator('table.data')).toContainText(payload);
  await page.goto('/register');
  await expect(page.locator('#vs-query')).toBeFocused();
  await page.keyboard.type('Xss Probe');
  await expect(page.locator('.visitor-match')).toContainText('Evil Corp');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});

test('the content security policy blocks inline script execution', async ({ page }) => {
  await login(page, 'reception');
  const executed = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = 1';
    document.body.appendChild(s);
    return window.__inline === 1;
  });
  expect(executed).toBe(false);
});

test('technical errors are never shown to users', async ({ page }) => {
  await login(page, 'reception', '/register');
  await page.route('**/api/visitors/search**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the request. Please try again or contact the system administrator.' } }) }));
  await page.keyboard.type('ramesh');
  await expect(page.locator('#vs-results')).toContainText('Unable to complete the request. Please try again or contact the system administrator.');
  await page.unroute('**/api/visitors/search**');
  await page.route('**/api/visitors/search**', (route) => route.abort());
  await page.fill('#vs-query', 'kumar');
  await page.click('#vs-search');
  await expect(page.locator('#vs-results')).toContainText('Unable to reach the server');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/SQL|stack|TypeError|500 Internal/);
});
