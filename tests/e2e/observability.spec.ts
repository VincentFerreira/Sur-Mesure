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
  await expect(fakeRow).toContainText('Analyse ATS');
  await expect(fakeRow).toContainText('Succès');
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
