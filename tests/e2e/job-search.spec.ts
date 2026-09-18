import { test, expect } from '@playwright/test';
import { testHooksAvailable, unique } from '../helpers/jobs';
import { API_URL } from '../helpers/apiUrl';

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
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();

  await page.getByTestId(`dismiss-scraped-job-${candidate.id}`).click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).not.toBeVisible();

  await page.getByTestId('scraped-jobs-tab-dismissed').click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).toBeVisible();
});

test('dismissing shows a non-blocking toast that persists an optional reason', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `dismiss-reason-${suffix}`,
    portal: 'france_travail',
    title: `QA Engineer ${suffix}`,
    company: `Dismiss Reason Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  // Dismissal itself is instant and unconditional — the row leaves the New tab right
  // away, before the toast is even considered.
  await page.getByTestId(`dismiss-scraped-job-${candidate.id}`).click();
  await expect(page.getByTestId(`scraped-job-row-${candidate.id}`)).not.toBeVisible();

  await expect(page.getByTestId('dismiss-reason-toast')).toBeVisible();
  await expect(page.getByTestId('dismiss-reason-toast')).toContainText(candidate.title);

  await page.getByTestId('dismiss-reason-input').fill('ESN / régie');
  await page.getByTestId('dismiss-reason-save').click();
  await expect(page.getByTestId('dismiss-reason-toast')).not.toBeVisible();

  const res = await request.get(`${API_URL}/api/scraper/candidates?status=dismissed`);
  const stored = (await res.json()).find((c: { id: string }) => c.id === candidate.id);
  expect(stored.dismissReason).toBe('ESN / régie');
});

test('closing the dismiss-reason toast without typing anything leaves no reason stored', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `dismiss-skip-${suffix}`,
    portal: 'france_travail',
    title: `QA Engineer ${suffix}`,
    company: `Dismiss Skip Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await page.getByTestId(`dismiss-scraped-job-${candidate.id}`).click();
  await expect(page.getByTestId('dismiss-reason-toast')).toBeVisible();

  await page.getByTestId('dismiss-reason-toast-close').click();
  await expect(page.getByTestId('dismiss-reason-toast')).not.toBeVisible();

  const res = await request.get(`${API_URL}/api/scraper/candidates?status=dismissed`);
  const stored = (await res.json()).find((c: { id: string }) => c.id === candidate.id);
  expect(stored.dismissReason).toBeFalsy();
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
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

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

test('an unviewed candidate shows the unseen dot; a viewed one renders under "déjà vues"', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const unseenCandidate = {
    id: crypto.randomUUID(),
    dedupeKey: `unseen-${suffix}`,
    fingerprint: `unseen-${suffix}`,
    portal: 'france_travail',
    title: `Unseen Engineer ${suffix}`,
    company: `Unseen Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/unseen-${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const seenCandidate = {
    id: crypto.randomUUID(),
    dedupeKey: `seen-${suffix}`,
    fingerprint: `seen-${suffix}`,
    portal: 'france_travail',
    title: `Seen Engineer ${suffix}`,
    company: `Seen Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/seen-${suffix}`,
    status: 'new',
    viewedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [unseenCandidate, seenCandidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId(`scraped-job-unseen-dot-${unseenCandidate.id}`).locator('span')).toBeVisible();
  await expect(page.getByTestId(`scraped-job-unseen-dot-${seenCandidate.id}`).locator('span')).not.toBeVisible();
  await expect(page.getByTestId('scraped-jobs-seen-separator')).toContainText('déjà vues');
  await expect(page.getByTestId(`scraped-job-row-${seenCandidate.id}`)).toBeVisible();
});

test('"Tout marquer comme vu" keeps dots visible until the next page load, per spec', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `markall-${suffix}`,
    fingerprint: `markall-${suffix}`,
    portal: 'france_travail',
    title: `Mark All Engineer ${suffix}`,
    company: `Mark All Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/markall-${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId(`scraped-job-unseen-dot-${candidate.id}`).locator('span')).toBeVisible();

  await page.getByTestId('mark-all-viewed-button').click();
  // The explicit "don't reshuffle until reload" requirement: right after clicking, the
  // dot must still show — local state is deliberately not mutated by this action.
  await expect(page.getByTestId(`scraped-job-unseen-dot-${candidate.id}`).locator('span')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`scraped-job-unseen-dot-${candidate.id}`).locator('span')).not.toBeVisible();
});

test('scrolling a row into view for 1s marks it viewed, surviving a reload', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  // Enough rows to push the target below the fold in a normal viewport.
  const filler = Array.from({ length: 15 }, (_, i) => ({
    id: crypto.randomUUID(),
    dedupeKey: `filler-${suffix}-${i}`,
    fingerprint: `filler-${suffix}-${i}`,
    portal: 'france_travail',
    title: `Filler Engineer ${suffix} ${i}`,
    company: `Filler Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/filler-${suffix}-${i}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  const target = {
    id: crypto.randomUUID(),
    dedupeKey: `target-${suffix}`,
    fingerprint: `target-${suffix}`,
    portal: 'france_travail',
    title: `Target Engineer ${suffix}`,
    company: `Target Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/target-${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [...filler, target] } });

  await page.goto('/job-search');
  await page.getByTestId(`scraped-job-row-${target.id}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300); // > the 1s visibility threshold

  await page.reload();
  await expect(page.getByTestId(`scraped-job-unseen-dot-${target.id}`).locator('span')).not.toBeVisible();
});

test('the sidebar badges "Découverte" with the unviewed-new count', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `badge-${suffix}`,
    fingerprint: `badge-${suffix}`,
    portal: 'france_travail',
    title: `Badge Engineer ${suffix}`,
    company: `Badge Co ${suffix}`,
    location: 'Paris',
    url: `https://example.test/jobs/badge-${suffix}`,
    status: 'new',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/jobs');
  await expect(page.getByTestId('nav-badge-job-search')).toBeVisible();
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
  await request.post(`${API_URL}/api/__test__/seed`, { data: { scrapedJobs: [candidate] } });

  await page.goto('/job-search');
  await expect(page.getByTestId('scraped-jobs-group-high')).toContainText('Fort · 1');
  await expect(page.getByTestId(`scraped-job-score-${candidate.id}`)).toContainText('92');
  await expect(page.getByTestId(`scraped-job-signal-${candidate.id}-0`)).toContainText('Playwright');
  await expect(page.getByTestId(`scraped-job-portal-${candidate.id}`)).toContainText('France Travail');
});

// Highest flake-risk test in this file: it's the only one driving a real
// POST /scraper/run (via "Lancer un scrape"), which depends on the shared
// SearchPreferences singleton that tests/e2e/preferences.spec.ts also mutates — the
// exact cross-file race this spec's other tests deliberately sidestep via seeding
// (see the file-level comment above). If this proves unstable in CI, remove it rather
// than retry, per this project's established convention.
test('the post-scrape banner reports unseen offers and a per-portal new-count after a real run', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  await request.put(`${API_URL}/api/preferences`, { data: { jobTitles: [`Banner Engineer ${suffix}`], locations: [] } });

  await page.goto('/job-search');
  await page.getByTestId('run-scrape-button').click();
  await expect(page.getByTestId('run-scrape-button')).toBeEnabled({ timeout: 15000 });

  await expect(page.getByTestId('unseen-banner')).toBeVisible();
  await expect(page.getByTestId('unseen-banner')).toContainText('inédite');
  await expect(page.getByTestId('unseen-banner')).toContainText('en correspondance forte');
  await expect(page.getByTestId('view-unseen-button')).toBeVisible();

  await page.getByTestId('view-unseen-button').click();
  await expect(page.getByTestId('scraped-jobs-tab-new')).toHaveClass(/text-indigo-600/);
});
