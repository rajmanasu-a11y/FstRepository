import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

const PAGES = ['/', '/register', '/check-in', '/check-out', '/on-premises', '/visitors', '/emergency'];
const SHOTS = process.env.E2E_SCREENSHOTS || 'test-results/screens';

for (const [name, device] of [['tablet', { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }],
  ['phone', { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
  test.describe(`${name} layout`, () => {
    test.use(device);

    test(`no horizontal page overflow and comfortable touch targets (${name})`, async ({ page }) => {
      await login(page, 'reception');
      for (const url of PAGES) {
        await page.goto(url);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${url} overflows horizontally`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${SHOTS}/${name}${url.replace(/\//g, '_') || '_root'}.png`, fullPage: true });
      }
      await page.goto('/register');
      await expect(page.locator('#vs-query')).toBeFocused();
      const heights = await page.locator('#btn-save, #btn-checkin, #vs-search, #v-name, #t-purpose').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(heights.length).toBe(5);
      // Checkbox labels keep their full width (guards against style collisions).
      const consent = await page.locator('#t-consent-box').boundingBox();
      expect(consent.width).toBeGreaterThan(250);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(43);
    });

    test(`navigation collapses into a menu (${name})`, async ({ page }) => {
      await login(page, 'reception');
      const toggle = page.locator('[data-nav-toggle]');
      await expect(toggle).toBeVisible();
      await expect(page.locator('#main-nav')).toBeHidden();
      await toggle.click();
      await expect(page.locator('#main-nav')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#main-nav a', { hasText: 'Check-Out' }).click();
      await expect(page.locator('h1')).toHaveText('Visitor Check-Out');
      await expect(page.locator('#main-nav')).toBeHidden();
    });
  });
}

test('desktop layout uses a two-column registration form', async ({ page }) => {
  await login(page, 'reception', '/register');
  const name = await page.locator('#v-name').boundingBox();
  const mobile = await page.locator('#v-mobile').boundingBox();
  expect(Math.abs(name.y - mobile.y)).toBeLessThan(5);
  expect(mobile.x).toBeGreaterThan(name.x + name.width);
  await page.screenshot({ path: `${SHOTS}/desktop_register.png`, fullPage: true });
});
