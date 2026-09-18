import { expect, type Page } from '@playwright/test';

export async function bulkAddCompanies(page: Page, names: string[]): Promise<void> {
  await page.goto('/companies');
  await page.getByTestId('bulk-add-companies-button').click();
  await page.getByTestId('bulk-companies-textarea').fill(names.join('\n'));
  await page.getByTestId('bulk-companies-review-button').click();
  await page.getByTestId('bulk-companies-confirm-button').click();
  await expect(page.getByTestId('bulk-companies-dialog')).not.toBeVisible();
}
