import { expect } from '@playwright/test';

export const PASSWORD = 'Vms@Demo2026';

export async function login(page, username, path = '/') {
  await page.goto(path);
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main .page h1, .print-toolbar').first()).toBeVisible();
  if (path.startsWith('/register')) await expect(page.locator('#vs-query')).toBeFocused();
}

/** Collect uncaught errors and failed API calls for a page. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

export const activeId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('data-use-visitor') || document.activeElement?.tagName);

export async function tabSequence(page, count, key = 'Tab') {
  const seq = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    seq.push(await activeId(page));
  }
  return seq;
}
