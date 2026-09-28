import { test, expect } from '@playwright/test';
import { login, activeId, tabSequence, watchErrors } from './helpers.js';

// The registration form's designed keyboard order (spec §27), with the few
// additional controls placed where they logically belong.
const ORDER = [
  'vs-query', 'vs-search', 'vs-new', 'vs-clear',
  'v-name', 'v-cc', 'v-mobile', 'v-email', 'v-company', 'v-designation', 'more-toggle',
  'v-idtype', 'v-idnumber', 'v-idverified', 'btn-capture', 'btn-upload',
  't-host', 't-dept', 't-purpose', 't-date', 't-arrival', 't-duration', 't-category',
  't-vehicle', 't-area', 't-consent',
  'btn-save', 'btn-checkin', 'btn-clear',
];

test.beforeEach(async ({ page }) => {
  await login(page, 'reception', '/register');
  await expect(page.locator('#vs-query')).toBeFocused();
});

test('initial focus is the Search Existing Visitor field', async ({ page }) => {
  expect(await activeId(page)).toBe('vs-query');
});

test('TAB follows the designed registration sequence', async ({ page }) => {
  const seq = ['vs-query', ...(await tabSequence(page, ORDER.length - 1))];
  expect(seq).toEqual(ORDER);
  // The recommended order from the specification is a subsequence of the real order.
  const recommended = ['vs-query', 'vs-search', 'vs-new', 'v-name', 'v-mobile', 'v-email', 'v-company', 'v-designation', 'v-idtype', 'v-idnumber',
    'btn-capture', 't-host', 't-dept', 't-purpose', 't-date', 't-arrival', 't-duration', 't-category', 't-vehicle', 't-area', 't-consent',
    'btn-save', 'btn-checkin', 'btn-clear'];
  let k = 0;
  for (const id of seq) if (id === recommended[k]) k++;
  expect(k).toBe(recommended.length);
});

test('SHIFT+TAB walks the same sequence backwards', async ({ page }) => {
  await page.focus('#btn-clear');
  const back = ['btn-clear', ...(await tabSequence(page, ORDER.length - 1, 'Shift+Tab'))];
  expect(back).toEqual([...ORDER].reverse());
});

test('hidden and disabled controls are skipped; revealed controls join in logical position', async ({ page }) => {
  // Print buttons are disabled until check-in and never receive focus.
  expect(ORDER).not.toContain('btn-print-pass');
  await expect(page.locator('#btn-print-pass')).toBeDisabled();

  // Vehicle details appear only once a registration number is entered.
  await page.focus('#t-vehicle');
  await page.keyboard.type('KA01AB1234');
  expect(await tabSequence(page, 4)).toEqual(['t-vehicle-type', 't-driver', 't-parking', 't-area']);

  // "Other" purpose reveals "Specify Purpose" directly after it.
  await page.selectOption('#t-purpose', { label: 'Other' });
  await page.focus('#t-purpose');
  expect(await tabSequence(page, 2)).toEqual(['t-purpose-other', 't-date']);

  // Optional contact fields are skipped until expanded with the keyboard.
  await page.focus('#more-toggle');
  await page.keyboard.press('Enter');
  expect(await activeId(page)).toBe('v-alt');
  expect(await tabSequence(page, 2)).toEqual(['v-address', 'v-idtype']);

  // ID verification remarks appear after the checkbox is ticked.
  await page.focus('#v-idverified');
  await page.keyboard.press('Space');
  expect(await tabSequence(page, 2)).toEqual(['v-idremarks', 'btn-capture']);
});

test('ENTER moves to the next field instead of submitting; CTRL+ENTER registers', async ({ page }) => {
  await page.focus('#v-name');
  await page.keyboard.type('Keyboard Only');
  await page.keyboard.press('Enter');
  expect(await activeId(page)).toBe('v-cc');
  await page.keyboard.press('Enter');
  expect(await activeId(page)).toBe('v-mobile');
  await expect(page.locator('[data-result]')).toBeEmpty();
  await page.keyboard.press('Control+Enter');
  // Validation runs and focuses the first invalid field.
  await expect(page.locator('#v-mobile-error')).toHaveText(/Mobile Number is required/);
  expect(await activeId(page)).toBe('v-mobile');
  await expect(page.locator('#v-mobile')).toHaveAttribute('aria-invalid', 'true');
});

test('F2 returns to the search field; ESC clears it', async ({ page }) => {
  await page.focus('#t-duration');
  await page.keyboard.press('F2');
  expect(await activeId(page)).toBe('vs-query');
  await page.keyboard.type('ramesh');
  await expect(page.locator('.visitor-match').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#vs-query')).toHaveValue('');
  await expect(page.locator('.visitor-match')).toHaveCount(0);
});

test('arrow keys navigate autocomplete suggestions; ENTER selects; ESC closes', async ({ page }) => {
  await page.focus('#t-host');
  await page.keyboard.type('kumar');
  const list = page.locator('#t-host ~ .combo-list, .combo:has(#t-host) .combo-list');
  await expect(list.locator('[role=option]').first()).toBeVisible();
  await expect(page.locator('#t-host')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  const activeOption = await page.locator('#t-host').getAttribute('aria-activedescendant');
  expect(activeOption).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.locator('#t-host')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(list.locator('[role=option]').first()).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-host-card]')).toContainText('Department');
  await expect(page.locator('#t-dept')).not.toHaveValue('');
});

test('native dropdowns change with the arrow keys', async ({ page }) => {
  await page.focus('#t-purpose');
  const before = await page.inputValue('#t-purpose');
  await page.keyboard.press('ArrowDown');
  expect(await page.inputValue('#t-purpose')).not.toBe(before);
});

test('date and time fields are single Tab stops that accept typing and arrow keys', async ({ page }) => {
  await page.focus('#t-date');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('+1');
  await page.keyboard.press('Tab');
  expect(await activeId(page)).toBe('t-arrival');
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 86400000);
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('day')}-${g('month')}-${g('year')}`;
  });
  await expect(page.locator('#t-date')).toHaveValue(tomorrow);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2:30 pm');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#t-arrival')).toHaveValue('02:45 PM');
});

test('modal dialogs trap focus and ESC closes them, returning focus to the opener', async ({ page }) => {
  await page.focus('#btn-capture');
  await page.keyboard.press('Enter');
  const dialog = page.locator('[role=dialog]');
  await expect(dialog).toBeVisible();
  for (let k = 0; k < 8; k++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('[role=dialog]')))).toBe(true);
  }
  for (let k = 0; k < 4; k++) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('[role=dialog]')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await activeId(page)).toBe('btn-capture');
});

test('keyboard-only registration, check-in and print of a new visitor', async ({ page }) => {
  const errors = watchErrors(page);
  // Search first (as a receptionist would), find nothing, then press New Visitor.
  await page.keyboard.type('9000012345');
  await page.keyboard.press('Enter');
  await expect(page.locator('#vs-results')).toContainText('No existing visitor found');
  await page.keyboard.press('Tab'); // Search
  await page.keyboard.press('Tab'); // New Visitor
  await page.keyboard.press('Enter');
  expect(await activeId(page)).toBe('v-name');
  await expect(page.locator('#v-mobile')).toHaveValue('9000012345');

  await page.keyboard.type('Meera Iyengar');
  await page.keyboard.press('Tab'); // country code
  await page.keyboard.press('Tab'); // mobile (prefilled)
  await page.keyboard.press('Tab');
  await page.keyboard.type('meera.iyengar@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Infosphere');
  await expect(page.locator('.combo:has(#v-company) [role=option]').first()).toContainText('Infosphere');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab'); // selects the highlighted company and moves on
  await expect(page.locator('#v-company')).toHaveValue('Infosphere Consulting LLP');
  expect(await activeId(page)).toBe('v-designation');
  await page.keyboard.type('Consultant');
  await page.keyboard.press('Tab'); // more-toggle
  await page.keyboard.press('Tab'); // ID type
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.type('ABCD1234');
  await page.keyboard.press('Tab'); // ID verified
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); // remarks
  await page.keyboard.press('Tab'); // capture
  await page.keyboard.press('Tab'); // upload
  await page.keyboard.press('Tab'); // host
  expect(await activeId(page)).toBe('t-host');
  await page.keyboard.type('Priya');
  await expect(page.locator('.combo:has(#t-host) [role=option]').first()).toContainText('Priya Sharma');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-host-card]')).toContainText('Deputy Director – Finance');
  await expect(page.locator('#t-dept option:checked')).toHaveText('Finance');
  await page.keyboard.press('Tab'); // department (auto)
  await page.keyboard.press('Tab'); // purpose
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#t-purpose option:checked')).toHaveText('Official Meeting');
  for (const _ of ['date', 'arrival', 'duration', 'category', 'vehicle', 'area', 'consent']) await page.keyboard.press('Tab');
  expect(await activeId(page)).toBe('t-consent');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  expect(await activeId(page)).toBe('btn-save');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-result]')).toContainText('Visitor registration completed successfully.');
  expect(await activeId(page)).toBe('btn-checkin');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-result]')).toContainText('Visitor successfully checked in.');
  await expect(page.locator('[data-result]')).toContainText(/PASS-\d{4}-\d{6}/);
  expect(await activeId(page)).toBe('btn-print-pass');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await expect(popup.locator('.pass')).toContainText('Meera Iyengar');
  await expect(popup.locator('[data-print]')).toBeFocused();
  await popup.close();
  // Clear starts the next registration from the search box.
  await page.focus('#btn-clear');
  await page.keyboard.press('Enter');
  expect(await activeId(page)).toBe('vs-query');
  expect(errors).toEqual([]);
});

test('check-in and check-out desks work entirely from the keyboard', async ({ page }) => {
  await page.goto('/check-in');
  await expect(page.locator('#ci-q')).toBeFocused();
  await page.keyboard.type('Shalini');
  await expect(page.locator('.lookup-item')).toHaveCount(1);
  await expect(page.locator('[data-detail]')).toContainText('Shalini Rao');
  // Auto-selected single match: focus is on the first checklist item.
  expect(await activeId(page)).toBe('ci-consent');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  if (await activeId(page) === 'ci-id') { await page.keyboard.press('Space'); await page.keyboard.press('Tab'); }
  await page.keyboard.press('Tab'); // access area → check in
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-detail]')).toContainText('Visitor successfully checked in.');
  await expect(page.locator('[data-print-pass]')).toBeFocused();

  await page.goto('/check-out');
  await expect(page.locator('#co-q')).toBeFocused();
  await page.keyboard.type('Shalini');
  await expect(page.locator('[data-do-checkout]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-detail]')).toContainText('Visitor check-out has been recorded successfully.');
  await expect(page.locator('[data-next]')).toBeFocused();
});

test('search results are reachable with ArrowDown and selectable with ENTER', async ({ page }) => {
  await page.keyboard.type('9876543210');
  await expect(page.locator('.visitor-match.best')).toContainText('Existing Visitor Found');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement.textContent.trim())).toContain('Use Existing Details');
  await page.keyboard.press('Enter');
  await expect(page.locator('#v-name')).toHaveValue('Ramesh Kumar');
  expect(await activeId(page)).toBe('t-host');
});
