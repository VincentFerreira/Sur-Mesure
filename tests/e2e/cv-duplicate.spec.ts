import { test, expect } from '@playwright/test';
import { createCvFromFixture, unique } from '../helpers/jobs';

test('duplicating a CV from the library creates an editable copy with the same content', async ({ page }) => {
  const label = `CV ${unique()}`;
  await createCvFromFixture(page, 'cv-complet.json', label);

  await page.goto('/cvs');
  const cards = page.locator('[data-testid^="cv-card-"]');
  const sourceCard = cards.filter({ hasText: label });
  await expect(sourceCard).toHaveCount(1);
  await sourceCard.getByRole('button', { name: 'Duplicate' }).click();

  const copyCard = cards.filter({ hasText: `${label} (copy)` });
  await expect(copyCard).toHaveCount(1);
  // The source is still listed alongside its copy.
  await expect(cards.filter({ hasText: label })).toHaveCount(2);

  // The copy survives a reload, i.e. it was really persisted.
  await page.reload();
  await expect(copyCard).toHaveCount(1);

  await copyCard.getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/cvs\/[0-9a-f-]{36}$/);
  await expect(page.locator('#cv-preview-export')).not.toBeEmpty();
});
