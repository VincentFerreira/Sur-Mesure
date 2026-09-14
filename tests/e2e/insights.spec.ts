import { test, expect } from '@playwright/test';
import { testHooksAvailable, unique } from '../helpers/jobs';

// The Analyse page's cards aggregate across ALL discoveries/jobs in the shared data
// directory (playwright.config.ts runs fullyParallel against one dir that other specs
// also write into), so assertions here check that the right row/section renders, never
// an exact count or percentage — exact-number correctness is covered by the
// __tests__/lib/insights*.test.ts unit suite instead. Portal ids are synthesized
// per-test (unique()) precisely so the per-portal yield card's aggregation can never be
// polluted by another spec's or another run's seeded candidates. Seeded candidates use
// status 'dismissed' rather than 'new' so they never surface in the Découverte page's
// default "Nouvelles" tab, whose own tests (tests/e2e/job-search.spec.ts) assert exact
// per-tier counts there — 'dismissed' still counts identically for every Analyse metric
// here (none of them filter by status except reviewConversion, which isn't exercised in
// this file).

test('a negative signal theme renders on the Découverte section', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const portal = `e2e-signals-${suffix}`;
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `signals-${suffix}`,
    portal,
    title: `QA Engineer ${suffix}`,
    company: `Signals Co ${suffix}`,
    location: 'Paris',
    isRemote: false,
    url: `https://example.test/jobs/${suffix}`,
    status: 'dismissed',
    fit: 'medium',
    score: 60,
    signals: [{ label: 'Sur site uniquement', polarity: 'negative' }],
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: [candidate] } });

  await page.goto('/insights');
  await expect(page.getByTestId('insights-section-search')).toBeVisible();
  await expect(page.getByTestId('signal-theme-negative-onsite')).toContainText('Présentiel imposé');
});

test('candidates without a score render an explicit "Non évalué" row, not silently dropped', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const candidate = {
    id: crypto.randomUUID(),
    dedupeKey: `unqualified-${suffix}`,
    portal: `e2e-unqualified-${suffix}`,
    title: `QA Engineer ${suffix}`,
    company: `Unqualified Co ${suffix}`,
    location: 'Paris',
    isRemote: false,
    url: `https://example.test/jobs/${suffix}`,
    status: 'dismissed',
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: [candidate] } });

  await page.goto('/insights');
  await expect(page.getByTestId('fit-row-unqualified')).toBeVisible();
  await expect(page.getByTestId('insight-card-fit')).toContainText('non évaluées');
});

test('a low-volume portal is listed as insufficient rather than ranked', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const portal = `e2e-lowvol-${suffix}`;
  const candidates = Array.from({ length: 3 }, (_, i) => ({
    id: crypto.randomUUID(),
    dedupeKey: `lowvol-${suffix}-${i}`,
    portal,
    title: `QA Engineer ${suffix}`,
    company: `Low Volume Co ${suffix}`,
    location: 'Paris',
    isRemote: false,
    url: `https://example.test/jobs/${suffix}-${i}`,
    status: 'dismissed',
    fit: 'high',
    score: 80,
    signals: [],
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  await request.post('http://localhost:3001/api/__test__/seed', { data: { scrapedJobs: candidates } });

  await page.goto('/insights');
  await expect(page.getByTestId('portal-insufficient')).toContainText('Volume insuffisant');
  await expect(page.getByTestId('portal-insufficient')).toContainText(portal);
});

test('the CV section renders missing keywords (case-merged) and a recurring formatting issue', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const cvId = crypto.randomUUID();
  await request.post('http://localhost:3001/api/__test__/seed', {
    data: { cvs: [{ id: cvId, label: `Insights CV ${suffix}`, language: 'fr', tags: [], contentHash: 'hash-1', data: {} }] },
  });

  // readAllJobs()'s file-listing order isn't creation order (job ids are random UUIDs),
  // so which casing "wins" the tie can't rely on which job is processed first. Instead,
  // 'TypeScript' is given more occurrences than 'typescript' so the most-frequent-casing
  // rule (see lib/insightsAts.ts topMissingKeywords) picks it deterministically.
  const uniqueKeyword = `QAZWSX${suffix.replace(/[^a-zA-Z0-9]/g, '')}`;
  const jobDefs = [
    { keyword: uniqueKeyword, formattingChecks: [{ label: 'Consistent date formats', status: 'fail' }] },
    { keyword: 'TypeScript', formattingChecks: [{ label: 'Consistent date formats', status: 'fail' }] },
    { keyword: 'TypeScript', formattingChecks: [] },
    { keyword: 'typescript', formattingChecks: [] },
  ];

  for (const [i, def] of jobDefs.entries()) {
    const createRes = await request.post('http://localhost:3001/api/jobs', {
      data: { company: `Insights Co ${suffix} ${i}`, title: 'QA Engineer', descriptionRaw: 'A QA role.' },
    });
    const job = await createRes.json();
    await request.post(`http://localhost:3001/api/jobs/${job.id}/score`, {
      data: {
        cvId,
        cvContentHash: 'hash-1',
        ats: {
          analysis: {
            overallScore: 50,
            estimatedNewScore: 70,
            criticalKeywords: [{ keyword: def.keyword, status: 'missing', frequency: 0, importance: 'critical', analysis: '' }],
            importantKeywords: [],
            formattingChecks: def.formattingChecks,
            recommendations: [],
            summary: '',
          },
          provider: 'fake',
          model: 'fake',
          promptVersion: 'v1',
          jobDescriptionHash: 'x',
        },
      },
    });
  }

  await page.goto('/insights');
  await expect(page.getByTestId(`missing-keyword-${uniqueKeyword}`)).toBeVisible();
  await expect(page.getByTestId('missing-keyword-TypeScript')).toBeVisible();
  await expect(page.getByTestId('missing-keyword-TypeScript')).toContainText('manquant dans 3 postes');
  await expect(page.getByTestId('formatting-row-dates')).toContainText('Format des dates');
  await expect(page.getByTestId('ats-score-current')).toBeVisible();
  await expect(page.getByTestId('ats-score-estimated')).toBeVisible();
});

test('a job rejected after reaching interview shows up in the funnel exits, not erased', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const job = {
    id: crypto.randomUUID(),
    company: `Funnel Co ${suffix}`,
    title: 'QA Engineer',
    status: 'rejected',
    priority: 2,
    descriptionRaw: 'A QA role.',
    keywords: [],
    submitted: true,
    events: [{ id: crypto.randomUUID(), type: 'status_change', from: 'interview', to: 'rejected', at: new Date().toISOString() }],
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await request.post('http://localhost:3001/api/__test__/seed', { data: { jobs: [job] } });

  await page.goto('/insights');
  await expect(page.getByTestId('funnel-stage-interview')).toBeVisible();
  await expect(page.getByTestId('funnel-exits')).toContainText('Entretien');
});

test('the page copy is French, with no leftover English labels from the old cards', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Analyse' })).toBeVisible();
  const text = await page.getByTestId('insights-page').innerText();
  expect(text).not.toContain('Score distribution');
  expect(text).not.toContain('Top missing keywords');
});
