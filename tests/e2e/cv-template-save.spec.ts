import { test, expect } from '@playwright/test';
import { importJsonFixture, closeCvManager } from '../helpers/cvManager';

const MARKER = '% E2E-CUSTOM-TEMPLATE-MARKER';
// The code editors are the only textareas with spellcheck off (the CV editor's summary has it on).
const CODE_EDITOR = 'textarea[spellcheck="false"]';

// Regression: saving a custom template didn't rebuild the generated LaTeX —
// the "LaTeX" view kept showing output from the previous template until the
// CV data or the font changed, so a saved template looked like it had no effect.
test('saving a custom template immediately updates the generated LaTeX', async ({ page }) => {
  await page.goto('/cvs/new');
  await importJsonFixture(page, 'cv-complet.json');
  await expect(page.getByText('CV imported. Save it to keep it.')).toBeVisible();
  await closeCvManager(page);

  const latexButtons = page.getByRole('button', { name: 'LaTeX', exact: true });
  await latexButtons.first().click(); // preview switcher
  await page.getByRole('button', { name: /Template/ }).click();

  const templateArea = page.locator(CODE_EDITOR);
  const original = await templateArea.inputValue();
  await templateArea.fill(original.replace('\\begin{document}', `\\begin{document}\n${MARKER}`));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible();

  await latexButtons.last().click(); // generated-LaTeX tab inside the viewer
  await expect(page.locator(CODE_EDITOR)).toHaveValue(new RegExp(MARKER));

  // Reset restores the default template and the generated LaTeX follows.
  await page.getByRole('button', { name: /Template/ }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await latexButtons.last().click();
  await expect(page.locator(CODE_EDITOR)).not.toHaveValue(new RegExp(MARKER));
});
