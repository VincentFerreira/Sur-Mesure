import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { importJsonFixture, closeCvManager } from '../helpers/cvManager';
import { normalizeForComparison } from '../helpers/cvFields';
import { readPdf } from '../helpers/pdf';

test.setTimeout(60_000);

// cv-complet.json, experience[0], FR bullets (in fixture order).
const FIRST = 'Conception de l';
const SECOND = 'Encadrement d';

test('reordering experience bullets in the editor updates the preview and the PDF export', async ({ page }) => {
  await page.goto('/cvs/new');
  await importJsonFixture(page, 'cv-complet.json');
  await expect(page.getByText('CV imported. Save it to keep it.')).toBeVisible();
  await closeCvManager(page);

  await page.getByTestId('section-header-experience').click();

  const firstRow = page.getByTestId('exp-0-bullet-0');
  const secondRow = page.getByTestId('exp-0-bullet-1');
  await expect(firstRow.getByRole('button', { name: 'Monter' })).toBeDisabled();
  await expect(secondRow.getByRole('button', { name: 'Descendre' })).toBeDisabled();

  await secondRow.getByRole('button', { name: 'Monter' }).click();

  // Editor: the second bullet is now first.
  await expect(firstRow.locator('input')).toHaveValue(new RegExp(`^${SECOND}`));
  await expect(secondRow.locator('input')).toHaveValue(new RegExp(`^${FIRST}`));

  // Preview: same order in the rendered bullet list.
  const previewBullets = page.locator('#cv-preview-export ul').first().locator('li');
  await expect(previewBullets.nth(0)).toHaveText(new RegExp(`^${SECOND}`));
  await expect(previewBullets.nth(1)).toHaveText(new RegExp(`^${FIRST}`));

  // PDF export: same order in the generated document.
  const exportButton = page.getByRole('button', { name: 'Export' });
  await exportButton.click();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.locator('..').getByRole('button', { name: 'PDF', exact: true }).click();
  const download = await downloadPromise;

  const destDir = path.join('test-results', 'downloaded-pdfs');
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `reorder-${download.suggestedFilename()}`);
  await download.saveAs(destPath);

  const text = normalizeForComparison((await readPdf(fs.readFileSync(destPath))).text);
  const firstAt = text.indexOf(normalizeForComparison(SECOND));
  const secondAt = text.indexOf(normalizeForComparison(FIRST));
  expect(firstAt, 'moved bullet missing from PDF').toBeGreaterThanOrEqual(0);
  expect(secondAt, 'other bullet missing from PDF').toBeGreaterThanOrEqual(0);
  expect(firstAt).toBeLessThan(secondAt);
});
