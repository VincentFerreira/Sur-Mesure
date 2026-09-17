import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { importJsonFixture } from './cvManager';
import { API_URL } from './apiUrl';

export const unique = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Imports a fixture with real, keyword-checkable content (unlike createCv's blank CV) and
// saves it under `label`. Leaves the CV Manager open on /cvs/<id> afterwards.
export async function createCvFromFixture(page: Page, fixtureName: string, label: string): Promise<void> {
  await page.goto('/cvs/new');
  await importJsonFixture(page, fixtureName);
  await expect(page.getByText('CV imported. Save it to keep it.')).toBeVisible();
  await page.getByPlaceholder('CV name (e.g. Senior Dev EN)').fill(label);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('CV saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
}

export async function createCv(page: Page, label: string): Promise<void> {
  await page.goto('/cvs/new');
  await page.getByTestId('cv-manager-button').click();
  await expect(page.getByRole('heading', { name: 'My CVs' })).toBeVisible();
  await page.getByPlaceholder('CV name (e.g. Senior Dev EN)').fill(label);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('CV saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
}

export async function createJob(page: Page, company: string, title: string, description?: string): Promise<void> {
  await page.goto('/jobs');
  await page.getByTestId('new-job-button').click();
  await page.getByTestId('job-company-input').fill(company);
  await page.getByTestId('job-title-input').fill(title);
  await page.getByTestId('job-description-input').fill(
    description ?? 'We are looking for a great engineer with strong TypeScript skills.'
  );
  await page.getByTestId('job-form-submit').click();
  await expect(page.getByTestId('job-form')).not.toBeVisible();
}

// Feature-detects the test-only /api/__test__/seed hook registered by server/testHooks.js.
// It's only enabled when the server is started with YARB_TEST_HOOKS=1 (which
// playwright.config.ts sets for servers it spawns itself) — never on a reused,
// already-running dev instance. Probing with an empty payload is side-effect-free
// (it writes nothing), unlike /api/__test__/reset, which would wipe data shared with
// other tests running concurrently (fullyParallel) and so is never called here.
export async function testHooksAvailable(request: APIRequestContext): Promise<boolean> {
  const res = await request.post(`${API_URL}/api/__test__/seed`, { data: { cvs: [] } });
  return res.ok();
}
