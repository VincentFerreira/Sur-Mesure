import { test, expect } from '@playwright/test';
import { createCvFromFixture, createJob, unique } from '../helpers/jobs';

// AI-generated application texts (quick pitch / full pitch / referral message) via
// server/scrapers/claudeCli.js's generateApplicationText — exercised here through the
// fake-provider path (server/scrapers/fake.js, VITE_ATS_PROVIDER=fake set by
// playwright.config.ts), never a real claude CLI invocation, per this repo's e2e
// convention (see CLAUDE.md).

test('the application-text section prompts to link a CV before it offers to generate anything', async ({ page }) => {
  const suffix = unique();
  const company = `Pitch Co ${suffix}`;
  await createJob(page, company, 'Frontend Engineer', 'A QA role.');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();

  await expect(page.getByTestId('application-text-section')).toContainText('Assign a CV');
  await expect(page.getByTestId('generate-quick-pitch')).not.toBeVisible();
});

test('generating each application text type shows editable, non-empty CV-grounded text', async ({ page }) => {
  const suffix = unique();
  const cvLabel = `Pitch CV ${suffix}`;
  const company = `Pitch Co ${suffix}`;

  await createCvFromFixture(page, 'cv-minimal.json', cvLabel);
  await createJob(page, company, 'Frontend Engineer', 'A QA role.');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();
  await page.getByTestId('cv-select').selectOption({ label: cvLabel });

  for (const [button, result] of [
    ['generate-quick-pitch', 'application-text-result-quick-pitch'],
    ['generate-full-pitch', 'application-text-result-full-pitch'],
    ['generate-referral-message', 'application-text-result-referral-message'],
  ] as const) {
    await page.getByTestId(button).click();
    const textarea = page.getByTestId(result);
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toHaveValue('');
    // Fake-provider output cites the job title verbatim (see fake.js's
    // generateApplicationText) — a real assertion that this is grounded in the actual
    // job, not a static placeholder.
    await expect(textarea).toHaveValue(/Frontend Engineer/);
  }

  // The result is editable, not a read-only blob (the "AI drafts, you edit" principle
  // from the feature's spec) — a manual edit sticks.
  const quickPitch = page.getByTestId('application-text-result-quick-pitch');
  await quickPitch.fill('A manually edited pitch.');
  await expect(quickPitch).toHaveValue('A manually edited pitch.');

  await expect(page.getByTestId('application-text-copy-quick-pitch')).toBeVisible();
});
