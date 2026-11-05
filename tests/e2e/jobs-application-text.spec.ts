import { test, expect } from '@playwright/test';
import { createCvFromFixture, createJob, testHooksAvailable, unique } from '../helpers/jobs';
import { API_URL } from '../helpers/apiUrl';

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

// Automatic experience-match insights (server/scrapers/claudeCli.js's
// evaluateExperienceMatches / fake.js's counterpart) — auto-triggered by the Discovery
// "Apply" flow (pages/JobSearchPage.tsx's handleSubmit) when Preferences has a CV
// configured, not a manual button. Asserts the final 'done' state rather than trying to
// catch the fleeting 'pending' moment — fake-provider resolution is fast enough that
// racing for it would be flaky (see the plan's note on this).
test('applying a discovered job with a Preferences CV configured auto-generates experience-match insights', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const cvLabel = `Insights CV ${suffix}`;
  const company = `Insights Co ${suffix}`;
  const title = `Backend Engineer ${suffix}`;

  await createCvFromFixture(page, 'cv-minimal.json', cvLabel);

  await page.goto('/preferences');
  await page.getByTestId('preferences-cv-select').selectOption({ label: cvLabel });
  await page.getByTestId('preferences-save-button').click();

  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `insights-${suffix}`,
    portal: 'france_travail',
    title,
    company,
    location: 'Lyon',
    url: `https://example.test/jobs/${suffix}`,
    status: 'new',
    descriptionRaw: 'We need a strong backend engineer.',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await page.getByTestId(`import-scraped-job-${candidate.id}`).click();
  await expect(page.getByTestId('job-form')).toBeVisible();
  await page.getByTestId('job-form-submit').click();

  // Submitting navigates straight to the new job's detail page.
  await expect(page.getByTestId('job-detail')).toBeVisible();

  const section = page.getByTestId('experience-insights-section');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('experience-insights-item').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('experience-insights-item').first()).toContainText(title);
});
