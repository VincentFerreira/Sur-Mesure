import { test, expect } from '@playwright/test';

// Preferences is a singleton (one record, no id) — every test here reads/writes the
// SAME server-side record, so this spec must run serially (not this file's tests in
// parallel with each other) or two saves race and one clobbers the other's data. This
// also assumes it's the only spec file touching /preferences across the whole
// Playwright run; a second preferences spec would need the same serial treatment (or
// a reset hook) to avoid racing this one.
test.describe.configure({ mode: 'serial' });

test('filling every field and reloading the page persists all of them', async ({ page }) => {
  await page.goto('/preferences');

  await page.getByTestId('job-titles-input').fill('QA Engineer');
  await page.getByTestId('job-titles-input').press('Enter');

  await page.getByTestId('locations-input').fill('Paris');
  await page.getByTestId('locations-input').press('Enter');

  await page.getByTestId('work-mode-remote-checkbox').check();
  await page.getByTestId('min-salary-input').fill('45000');

  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();

  await expect(page.getByTestId('job-titles-list')).toContainText('QA Engineer');
  await expect(page.getByTestId('locations-list')).toContainText('Paris');
  await expect(page.getByTestId('work-mode-remote-checkbox')).toBeChecked();
  await expect(page.getByTestId('min-salary-input')).toHaveValue('45000');
});

test('clicking the Add button (not pressing Enter) commits a tag', async ({ page }) => {
  await page.goto('/preferences');

  await page.getByTestId('job-titles-input').fill('SDET');
  await page.getByTestId('job-titles-add-button').click();
  await expect(page.getByTestId('job-titles-list')).toContainText('SDET');
  // The click must not have also submitted via some other path with an empty draft.
  await expect(page.getByTestId('job-titles-input')).toHaveValue('');

  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('job-titles-list')).toContainText('SDET');
});

// Regression: a real user reported job titles/locations "not saving" — root cause was
// that typing a value and clicking Save directly (without knowing to press Enter)
// silently dropped the in-progress text, since it only ever lived in TagInput's local
// draft state until committed. This is exactly the naive path a real user takes and
// the original e2e suite never exercised it (it only ever used `.press('Enter')`).
test('typing a value and clicking Save directly, without pressing Enter first, still persists it', async ({ page }) => {
  await page.goto('/preferences');

  await page.getByTestId('job-titles-input').fill('Untouched Draft Title');
  await page.getByTestId('locations-input').fill('Lyon');
  // No Enter, no Add click — go straight to Save, like a user who doesn't know the
  // tag-input convention.
  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('job-titles-list')).toContainText('Untouched Draft Title');
  await expect(page.getByTestId('locations-list')).toContainText('Lyon');
});

test('add, remove, retype without committing, then Save: only the retyped value is kept', async ({ page }) => {
  await page.goto('/preferences');

  await page.getByTestId('job-titles-input').fill('Discarded');
  await page.getByTestId('job-titles-add-button').click();
  const pill = page.getByTestId('job-titles-list').locator('span', { hasText: 'Discarded' });
  await pill.getByRole('button').click();
  await expect(page.getByTestId('job-titles-list')).not.toBeVisible();

  await page.getByTestId('job-titles-input').fill('Kept After Retype');
  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('job-titles-list')).toContainText('Kept After Retype');
  await expect(page.locator('body')).not.toContainText('Discarded');
});

test('a removed tag no longer appears after saving and reloading', async ({ page }) => {
  await page.goto('/preferences');

  await page.getByTestId('job-titles-input').fill('Temporary Title');
  await page.getByTestId('job-titles-input').press('Enter');
  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();

  const pill = page.getByTestId('job-titles-list').locator('span', { hasText: 'Temporary Title' });
  await pill.getByRole('button').click();
  await page.getByTestId('preferences-save-button').click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('job-titles-input')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Temporary Title');
});
