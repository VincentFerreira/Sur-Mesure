import { test, expect } from '@playwright/test';
import { createCvFromFixture, createJob, unique } from '../helpers/jobs';
import { API_URL } from '../helpers/apiUrl';

// Exercises the full instrumentation path found via interactive testing while building
// the Observability page: a fake-provider ATS analysis (VITE_ATS_PROVIDER=fake, set by
// playwright.config.ts) still goes through services/aiService.ts's recordAiCall ->
// services/observabilityService.ts -> POST /api/observability/calls -> the SQLite log ->
// GET /api/observability/calls, so the row shows up on /observability without ever
// hitting a real Gemini/Claude API. Per CLAUDE.md, this is the non-regression spec for
// the whole feature (an MCP/manual finding must become a tests/e2e/ spec, not stay
// anecdotal).

test('computing an ATS score logs a fake-provider call visible on the Observability page', async ({ page }) => {
  const suffix = unique();
  const cvLabel = `Observability CV ${suffix}`;
  const company = `Observability Co ${suffix}`;

  await createCvFromFixture(page, 'cv-minimal.json', cvLabel);
  await createJob(page, company, 'Frontend Engineer', 'javascript graphql testing docker kubernetes');

  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();
  await page.getByTestId('cv-select').selectOption({ label: cvLabel });
  await page.getByTestId('compute-score-button').click();
  await expect(page.getByTestId('ats-report')).toBeVisible();

  await page.goto('/observability');
  await expect(page.getByTestId('observability-page')).toBeVisible();
  const fakeRow = page.getByTestId('obs-call-row').filter({ hasText: 'Fake' }).first();
  await expect(fakeRow).toBeVisible();
  await expect(fakeRow).toContainText('ATS analysis');
  await expect(fakeRow).toContainText('Success');

  // Clicking the row expands the lazy-fetched detail panel — full prompt/response
  // text, not just the metadata columns already visible in the table.
  await fakeRow.click();
  await expect(page.getByTestId('obs-call-detail')).toBeVisible();
  await expect(page.getByTestId('obs-call-detail-response')).toBeVisible();
});

test('the provider filter narrows the calls table', async ({ page, request }) => {
  const suffix = unique();
  const cvLabel = `Observability Filter CV ${suffix}`;
  const company = `Observability Filter Co ${suffix}`;

  await createCvFromFixture(page, 'cv-minimal.json', cvLabel);
  await createJob(page, company, 'Frontend Engineer', 'javascript graphql testing docker kubernetes');
  await page.locator('tr', { hasText: company }).click();
  await expect(page.getByTestId('job-detail')).toBeVisible();
  await page.getByTestId('cv-select').selectOption({ label: cvLabel });
  await page.getByTestId('compute-score-button').click();
  await expect(page.getByTestId('ats-report')).toBeVisible();

  // Also log a claude_cli row directly via the API, so the filter has something to
  // exclude — no real CLI/network access needed for this.
  await request.post(`${API_URL}/api/observability/calls`, {
    data: { provider: 'claude_cli', operation: 'search_all', durationMs: 500, status: 'success' },
  });

  await page.goto('/observability');
  await expect(page.getByTestId('observability-page')).toBeVisible();
  await page.getByTestId('obs-filter-provider').selectOption('fake');
  await expect(page.getByTestId('obs-calls-table')).toBeVisible();
  const rows = page.getByTestId('obs-call-row');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toContainText('Fake');
  }
});

// No fake-provider path exercises a real prompt/step-trace deterministically (search_all
// only ever runs via the real `claude` CLI), so this seeds a full claude_cli/search_all
// row directly via the API — the same lazy-fetch/render path a real run would take.
test('a search_all call with a step trace shows prompt, response and the step-by-step trace when expanded', async ({ page, request }) => {
  const stepTrace = [
    { seq: 1, at: new Date().toISOString(), tool: 'WebSearch', input: { query: 'QA Engineer Paris' }, status: 'done', resultSnippet: '2 results found' },
    { seq: 2, at: new Date().toISOString(), tool: 'WebFetch', input: { url: 'https://example.test/jobs/1' }, status: 'failed', resultSnippet: 'HTTP 404 Not Found' },
  ];
  await request.post(`${API_URL}/api/observability/calls`, {
    data: {
      provider: 'claude_cli',
      operation: 'search_all',
      durationMs: 45_000,
      status: 'success',
      prompt: 'You are helping a job seeker find current openings...',
      responseText: '[]',
      stepTrace,
    },
  });

  await page.goto('/observability');
  await expect(page.getByTestId('observability-page')).toBeVisible();
  const row = page.getByTestId('obs-call-row').filter({ hasText: 'Web search' }).first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByTestId('obs-call-detail-prompt')).toContainText('helping a job seeker');
  await expect(page.getByTestId('obs-call-detail-response')).toContainText('[]');
  const steps = page.getByTestId('obs-call-detail-step');
  await expect(steps).toHaveCount(2);
  await expect(steps.first()).toContainText('QA Engineer Paris');
  await expect(steps.nth(1)).toContainText('example.test/jobs/1');
});

test('an error call shows both the short error message and the full technical error detail when expanded', async ({ page, request }) => {
  await request.post(`${API_URL}/api/observability/calls`, {
    data: {
      provider: 'claude_cli',
      operation: 'expand_keywords',
      durationMs: 200,
      status: 'error',
      errorMessage: 'claude CLI returned unparsable output',
      errorDetail: 'This is the raw stdout that failed JSON.parse: {not valid json',
    },
  });

  await page.goto('/observability');
  await expect(page.getByTestId('observability-page')).toBeVisible();
  const row = page.getByTestId('obs-call-row').filter({ hasText: 'Error' }).filter({ hasText: 'Keyword expansion' }).first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByTestId('obs-call-detail-error')).toContainText('claude CLI returned unparsable output');
  await expect(page.getByTestId('obs-call-detail-error-detail')).toContainText('raw stdout that failed JSON.parse');
});
