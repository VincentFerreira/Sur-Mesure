import { test, expect } from '@playwright/test';
import { createJob, unique } from '../helpers/jobs';
import { bulkAddCompanies } from '../helpers/companies';

test('bulk-adding a list of company names adds a row for each new one', async ({ page }) => {
  const suffix = unique();
  const existingName = `Existing-${suffix}`;
  const newNameA = `New-A-${suffix}`;
  const newNameB = `New-B-${suffix}`;

  await bulkAddCompanies(page, [existingName]);
  await expect(page.getByTestId('bulk-add-companies-button')).toBeVisible();

  await page.getByTestId('bulk-add-companies-button').click();
  await page.getByTestId('bulk-companies-textarea').fill([newNameA, newNameB, existingName].join('\n'));
  await page.getByTestId('bulk-companies-review-button').click();

  await expect(page.getByText('2 new companies')).toBeVisible();
  await expect(page.getByText('1 already exist')).toBeVisible();

  await page.getByTestId('bulk-companies-confirm-button').click();
  await expect(page.getByTestId('bulk-companies-dialog')).not.toBeVisible();

  await expect(page.getByText(newNameA)).toBeVisible();
  await expect(page.getByText(newNameB)).toBeVisible();
});

test('a company bulk-added after a matching job exists shows that job instead of "No QA position yet"', async ({ page }) => {
  const company = `Linked-${unique()}`;
  const title = 'QA Automation Engineer';

  await createJob(page, company, title);
  await bulkAddCompanies(page, [company]);

  const row = page.locator('[data-testid^="company-row-"]', { hasText: company });
  await expect(row).toBeVisible();
  await expect(row.getByText(title)).toBeVisible();
  await expect(row.getByText('No QA position yet')).not.toBeVisible();
});

test('the "Add from jobs" sync button seeds a company for a job that has none yet, with the link already set', async ({ page }) => {
  const company = `Sync-${unique()}`;
  const title = 'QA Engineer';

  await createJob(page, company, title);
  await page.goto('/companies');

  await page.getByTestId('sync-companies-from-jobs-button').click();

  const row = page.locator('[data-testid^="company-row-"]', { hasText: company });
  await expect(row).toBeVisible();
  await expect(row.getByText(title)).toBeVisible();
});

test('a newly created company appears as a suggestion in the job form company field', async ({ page }) => {
  const company = `Suggest-${unique()}`;
  await bulkAddCompanies(page, [company]);

  await page.goto('/jobs');
  await page.getByTestId('new-job-button').click();
  await expect(page.getByTestId('job-company-input')).toBeVisible();

  // <option value={c.name} /> has no text content (only a `value` attribute), so match
  // on the attribute rather than `hasText` (which reads textContent and would never match).
  await expect(page.locator(`#job-company-suggestions option[value="${company}"]`)).toHaveCount(1);
});

test('clicking a company row opens an edit form and saved changes persist in the table', async ({ page }) => {
  const company = `Edit-${unique()}`;
  await bulkAddCompanies(page, [company]);

  const row = page.locator('[data-testid^="company-row-"]', { hasText: company });
  await row.click();

  await expect(page.getByTestId('company-form')).toBeVisible();
  await page.getByTestId('company-location-input').fill('Paris');
  await page.getByTestId('company-form-submit').click();
  await expect(page.getByTestId('company-form')).not.toBeVisible();

  await expect(row).toContainText('Paris');
});

test('deleting a company linked to a job is blocked with an explicit message', async ({ page }) => {
  const company = `Blocked-Delete-${unique()}`;
  await createJob(page, company, 'QA Engineer');
  await bulkAddCompanies(page, [company]);

  const row = page.locator('[data-testid^="company-row-"]', { hasText: company });
  await row.click();
  await expect(page.getByTestId('company-form')).toBeVisible();

  await page.getByTestId('company-delete-button').click();
  await page.getByTestId('company-delete-button').click();

  await expect(page.getByTestId('company-form')).toContainText('linked to one or more jobs');
});
