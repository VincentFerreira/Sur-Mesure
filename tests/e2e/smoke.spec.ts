import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/apiUrl';

// Fast fail-fast gate, run as its own CI step *before* the full suite (see
// .github/workflows/ci.yml) — deliberately minimal so it stays fast and can't itself
// be flaky. playwright.config.ts's webServer already waits for the Vite and Express
// processes to be *listening* before any test runs, but that only proves the HTTP
// servers are up — not that the React app actually renders without crashing. That gap
// is exactly what let a `process.env.API_KEY`-undefined crash (services/aiService.ts,
// fixed the same day this test was added) go undetected: Vite still served the HTML
// shell (200 OK), but the bundle threw synchronously on import and nothing ever
// painted, so all 55 other e2e tests failed independently with generic 30s "element
// not found" timeouts — ~6 minutes of CI time with no indication anywhere of the real
// cause. This test would have caught it in seconds, with the actual error message.
test('smoke: API is healthy and the app renders on its core pages without a client-side crash', { tag: '@smoke' }, async ({ page, request }) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: 'ok' });

  // Registered before any navigation — captures an uncaught client-side exception
  // with its real message/stack, rather than letting the caller only ever see a
  // downstream "element not found" timeout with no indication of the actual cause.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  // Three representative pages, not just the landing one — a crash can be scoped to
  // one page's own import graph rather than the whole bundle, so checking only "/"
  // wouldn't have caught a bug isolated to, say, the Preferences or Observability page.
  await page.goto('/');
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByText('Sur-Mesure')).toBeVisible();
  await expect(page.getByTestId('jobs-page')).toBeVisible();

  await page.goto('/preferences');
  await expect(page.getByTestId('preferences-page')).toBeVisible();

  await page.goto('/observability');
  await expect(page.getByTestId('observability-page')).toBeVisible();

  expect(pageErrors, `Uncaught client-side error(s): ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);
});
