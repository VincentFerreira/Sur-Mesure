import { test, expect } from '@playwright/test';
import { createCv, createJob, testHooksAvailable, unique } from '../helpers/jobs';
import { API_URL } from '../helpers/apiUrl';

test('T1 - creating a job by pasting a description adds it to the table at status lead', async ({ page }) => {
  const company = `Acme-${unique()}`;
  const title = 'Senior Frontend Engineer';

  await createJob(page, company, title);

  const row = page.locator('tr', { hasText: company });
  await expect(row).toBeVisible();
  await expect(row.getByText('Lead')).toBeVisible();
});

test('T5 - marking a job applied without a CV assigned is blocked with an explicit message', async ({ page }) => {
  const company = `Blocked-${unique()}`;
  await createJob(page, company, 'Backend Engineer');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();

  await page.getByTestId('status-select').selectOption('applied');

  await expect(page.getByTestId('status-error')).toBeVisible();
  await expect(page.getByTestId('status-error')).toContainText('Assign a CV');
  // The blocked change must not have been applied.
  await expect(page.getByTestId('status-select')).toHaveValue('lead');
});

test('T4 - assigning the sent CV then marking applied appends a status_change event', async ({ page }) => {
  const cvLabel = `CV-${unique()}`;
  const company = `Sent-${unique()}`;

  await createCv(page, cvLabel);
  await createJob(page, company, 'Platform Engineer');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();

  await page.getByTestId('cv-select').selectOption({ label: cvLabel });
  await page.getByTestId('status-select').selectOption('applied');

  await expect(page.getByTestId('status-select')).toHaveValue('applied');
  await expect(page.getByTestId('job-timeline')).toContainText('Status changed: Lead → Applied');
});

test('T8 - filtering on "stale score only" shows only jobs whose score is out of date', async ({ page, request }) => {
  test.skip(!(await testHooksAvailable(request)), 'Test hooks not enabled on this server instance.');

  const suffix = unique();
  const staleCompany = `Stale Co ${suffix}`;
  const freshCompany = `Fresh Co ${suffix}`;

  const cv = {
    id: crypto.randomUUID(),
    label: `Fresh CV ${suffix}`,
    language: 'en',
    tags: [],
    contentHash: 'hash-current',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await request.post(`${API_URL}/api/__test__/seed`, { data: { cvs: [cv] } });

  const fakeAnalysis = {
    overallScore: 80,
    estimatedNewScore: 90,
    criticalKeywords: [],
    importantKeywords: [],
    formattingChecks: [],
    recommendations: [],
    summary: 'Seeded for the stale-only filter test.',
  };

  const staleJob = await request.post(`${API_URL}/api/jobs`, {
    data: { company: staleCompany, title: 'Stale Role', descriptionRaw: 'desc' },
  });
  const { id: staleJobId } = await staleJob.json();
  await request.post(`${API_URL}/api/jobs/${staleJobId}/score`, {
    data: {
      cvId: cv.id,
      cvContentHash: 'hash-outdated',
      ats: {
        analysis: fakeAnalysis,
        provider: 'fake',
        model: 'fake',
        promptVersion: 'v1',
        jobDescriptionHash: 'irrelevant',
      },
    },
  });

  const freshJob = await request.post(`${API_URL}/api/jobs`, {
    data: { company: freshCompany, title: 'Fresh Role', descriptionRaw: 'desc' },
  });
  const { id: freshJobId } = await freshJob.json();
  await request.post(`${API_URL}/api/jobs/${freshJobId}/score`, {
    data: {
      cvId: cv.id,
      cvContentHash: cv.contentHash,
      ats: {
        analysis: fakeAnalysis,
        provider: 'fake',
        model: 'fake',
        promptVersion: 'v1',
        jobDescriptionHash: 'irrelevant',
      },
    },
  });

  await page.goto('/jobs');
  await expect(page.getByText(staleCompany)).toBeVisible();
  await expect(page.getByText(freshCompany)).toBeVisible();

  await page.getByTestId('stale-only-filter').check();

  await expect(page.getByText(staleCompany)).toBeVisible();
  await expect(page.getByText(freshCompany)).not.toBeVisible();
});
