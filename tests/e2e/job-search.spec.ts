import { test, expect } from '@playwright/test';
import { testHooksAvailable, unique } from '../helpers/jobs';

// Seeds candidates directly via the test-only seed hook rather than clicking "Run
// search": that button depends on the shared SearchPreferences singleton, which
// tests/e2e/preferences.spec.ts also mutates — seeding sidesteps that cross-file race
// entirely and lets this spec focus on the client-side review/import/dismiss flow
// (the scrape-and-dedupe logic itself is covered server-side by
// __tests__/server.scraper.test.ts).

test('dismissing a scraped job moves it out of the New tab', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `dismiss-${suffix}`,
    portal: 'france_travail',
    title: `QA Engineer ${suffix}`,
    company: `Dismiss Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();

  await page.getByTestId(`dismiss-scraped-job-${candidate.id}`).click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).not.toBeVisible();

  await page.getByTestId('scraped-jobs-tab-dismissed').click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();
});

test('importing a scraped job prefills JobForm, creates a real job, and moves the candidate to Imported', async ({
  page,
  request,
}) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const company = `Import Co ${suffix}`;
  const title = `Backend Engineer ${suffix}`;
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `import-${suffix}`,
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
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();

  await page.getByTestId(`import-scraped-job-${candidate.id}`).click();

  await expect(page.getByTestId('job-form')).toBeVisible();
  await expect(page.getByTestId('job-company-input')).toHaveValue(company);
  await expect(page.getByTestId('job-title-input')).toHaveValue(title);
  await expect(page.getByTestId('job-description-input')).toHaveValue(candidate.descriptionRaw);

  await page.getByTestId('job-form-submit').click();
  await expect(page.getByTestId('job-form')).not.toBeVisible();

  // The candidate moved to Imported instead of staying under New.
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).not.toBeVisible();
  await page.getByTestId('scraped-jobs-tab-imported').click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();

  await page.goto('/jobs');
  await expect(page.locator('tr', { hasText: company })).toBeVisible();
});

test('a qualified candidate renders its score, tier group, and chips', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `qualified-${suffix}`,
    portal: 'france_travail',
    title: `QA Playwright ${suffix}`,
    company: `Qualified Co ${suffix}`,
    location: 'Paris',
    isRemote: false,
    url: `https://example.test/jobs/${suffix}`,
    status: 'new',
    fit: 'high',
    score: 92,
    signals: [
      { label: 'Playwright', polarity: 'positive' },
      { label: 'TypeScript', polarity: 'positive' },
    ],
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId('scraped-jobs-group-high')).toContainText('Fort · 1');
  await expect(page.getByTestId(`scraped-job-score-${candidate.id}`)).toContainText('92');
  await expect(page.getByTestId(`scraped-job-signal-${candidate.id}-0`)).toContainText('Playwright');
  await expect(page.getByTestId(`scraped-job-portal-${candidate.id}`)).toContainText('France Travail');
});
