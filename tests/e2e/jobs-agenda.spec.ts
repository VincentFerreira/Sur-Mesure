import { test, expect } from '@playwright/test';
import { createJob, unique } from '../helpers/jobs';

// datetime-local value for tomorrow at 10:00 local time.
function tomorrowAt10(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

test('appointment added on a job shows in the Agenda view, and leaves it once done', async ({ page }) => {
  const company = `Agenda Co ${unique()}`;
  await createJob(page, company, 'Platform Engineer');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();

  await page.getByTestId('add-appointment-button').click();
  await page.getByTestId('appointment-form-at').fill(tomorrowAt10());
  await page.getByTestId('appointment-form-type').selectOption('call');
  await page.getByTestId('appointment-form-label').fill('Call with the headhunter');
  await page.getByTestId('appointment-form-contact').fill('Externatic');
  await page.getByTestId('appointment-form-submit').click();
  await expect(page.getByTestId('appointment-form')).not.toBeVisible();
  await expect(page.getByTestId('appointments-section')).toContainText('Call with the headhunter');

  await page.goto('/jobs');
  await page.getByTestId('view-agenda-button').click();
  const group = page.getByTestId('agenda-group-thisWeek');
  await expect(group).toContainText('Call with the headhunter');
  await expect(group).toContainText('with Externatic');
  await expect(group).toContainText(company);

  // The view choice persists across reloads.
  await page.reload();
  await expect(page.getByTestId('jobs-agenda')).toBeVisible();

  const item = page.locator('[data-testid^="agenda-item-"]', { hasText: company });
  await item.locator('[data-testid^="agenda-done-"]').click();
  await expect(page.getByTestId('jobs-agenda')).not.toContainText(company);

  await page.reload();
  await expect(page.getByTestId('jobs-agenda')).not.toContainText(company);

  // Marking a call done logs it on the job's timeline.
  await page.getByTestId('view-table-button').click();
  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-timeline')).toContainText('Call with the headhunter');
});
