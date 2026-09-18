import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { importJsonFixture, closeCvManager } from '../helpers/cvManager';
import { loadCvFixture } from '../helpers/fixtures';
import { walkCvLeafStrings, normalizeForComparison } from '../helpers/cvFields';
import { readPdf, readPdfTextPositions } from '../helpers/pdf';

test.setTimeout(60_000);

async function importAndExportPdf(page: import('@playwright/test').Page, fixtureName: string) {
  await page.goto('/cvs/new');
  await importJsonFixture(page, fixtureName);
  await expect(page.getByText('CV imported. Save it to keep it.')).toBeVisible();
  await closeCvManager(page);

  const exportButton = page.getByRole('button', { name: 'Export' });
  await exportButton.click();
  const exportMenu = exportButton.locator('..');
  const downloadPromise = page.waitForEvent('download');
  await exportMenu.getByRole('button', { name: 'PDF', exact: true }).click();
  const download = await downloadPromise;

  const destDir = path.join('test-results', 'downloaded-pdfs');
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, download.suggestedFilename());
  await download.saveAs(destPath);

  return { download, buffer: fs.readFileSync(destPath) };
}

test('T3 - export PDF déclenche un téléchargement nommé correctement', async ({ page }) => {
  const cv = loadCvFixture('cv-complet.json');
  const { download, buffer } = await importAndExportPdf(page, 'cv-complet.json');

  expect(download.suggestedFilename()).toBe(
    `cv_${cv.personalInfo.firstName}_${cv.personalInfo.lastName}.pdf`
  );
  expect(buffer.length).toBeGreaterThan(0);
});

test('T4 - le PDF produit est structurellement valide et contient le contenu clé', async ({ page }) => {
  const cv = loadCvFixture('cv-complet.json');
  const { buffer } = await importAndExportPdf(page, 'cv-complet.json');

  const pdf = await readPdf(buffer);
  const text = normalizeForComparison(pdf.text);

  expect(pdf.numPages).toBe(1);

  const keyValues = [
    cv.personalInfo.firstName,
    cv.personalInfo.lastName,
    cv.personalInfo.email,
    cv.experience[0].company,
    cv.experience[0].role.fr,
    cv.skills[0].items.fr,
  ];
  for (const value of keyValues) {
    expect(text, `champ manquant dans le PDF : "${value}"`).toContain(normalizeForComparison(value!));
  }
});

test('T5 - les accents et caractères Unicode sont préservés dans le PDF', async ({ page }) => {
  const cv = loadCvFixture('cv-accents.json');
  const { buffer } = await importAndExportPdf(page, 'cv-accents.json');

  const pdf = await readPdf(buffer);
  const text = normalizeForComparison(pdf.text);

  const expectedValues = walkCvLeafStrings(cv, cv.currentLanguage);
  for (const value of expectedValues) {
    expect(text, `chaîne accentuée manquante ou corrompue dans le PDF : "${value}"`).toContain(
      normalizeForComparison(value)
    );
  }
});

test('T6 - un titre de section ne reste jamais orphelin en bas de page', async ({ page }) => {
  const { buffer } = await importAndExportPdf(page, 'cv-page-break-edge.json');

  const pdf = await readPdf(buffer);
  expect(pdf.numPages).toBeGreaterThan(1);

  const pageOf = (needle: string) =>
    pdf.pages.find(p => normalizeForComparison(p.text).includes(normalizeForComparison(needle)))?.num;

  const sections = [
    { header: 'EDUCATION', firstContent: "Master's Degree in Software Architecture" },
    { header: 'CERTIFICATIONS', firstContent: 'ISTQB Certified Tester Foundation Level' },
    { header: 'LANGUAGES', firstContent: 'French (Native)' },
  ];

  for (const { header, firstContent } of sections) {
    const headerPage = pageOf(header);
    const contentPage = pageOf(firstContent);
    expect(headerPage, `titre de section "${header}" introuvable dans le PDF`).toBeDefined();
    expect(contentPage, `contenu "${firstContent}" introuvable dans le PDF`).toBeDefined();
    expect(
      contentPage,
      `le titre "${header}" (page ${headerPage}) est séparé de son contenu (page ${contentPage})`
    ).toBe(headerPage);
  }
});

test("T7 - tous les titres de section partagent la même marge gauche", async ({ page }) => {
  const { buffer } = await importAndExportPdf(page, 'cv-complet.json');

  const items = await readPdfTextPositions(buffer);
  const titles = ['COMPÉTENCES', 'EXPÉRIENCE', 'ÉDUCATION', 'CERTIFICATIONS', 'LANGUES'];

  const positions = titles.map(title => {
    const found = items.find(i => i.str.trim() === title);
    expect(found, `titre "${title}" introuvable dans le PDF`).toBeDefined();
    return { title, x: found!.x };
  });

  const referenceX = positions[0].x;
  for (const { title, x } of positions) {
    expect(Math.abs(x - referenceX), `le titre "${title}" (x=${x}) n'est pas aligné avec les autres (x=${referenceX})`).toBeLessThan(0.5);
  }
});

test("T8 - l'espace entre un titre de section et son contenu reste cohérent d'une section à l'autre", async ({ page }) => {
  const { buffer } = await importAndExportPdf(page, 'cv-complet.json');

  const items = await readPdfTextPositions(buffer);
  const findY = (needle: string) => {
    const found = items.find(i => i.str.trim() === needle);
    expect(found, `texte "${needle}" introuvable dans le PDF`).toBeDefined();
    return found!.y;
  };

  // EXPÉRIENCE est exclue : chaque entrée y réserve son propre espace via
  // \needspace, ce qui produit structurellement un écart plus grand sous le titre.
  const sections = [
    { title: 'COMPÉTENCES', firstContent: 'Langages' },
    { title: 'ÉDUCATION', firstContent: '2013 – 2015' },
    { title: 'CERTIFICATIONS', firstContent: '2023' },
    { title: 'LANGUES', firstContent: 'Français (Langue maternelle)' },
  ];

  const gaps = sections.map(({ title, firstContent }) => ({
    title,
    gap: findY(title) - findY(firstContent),
  }));

  const referenceGap = gaps[0].gap;
  for (const { title, gap } of gaps) {
    expect(
      Math.abs(gap - referenceGap),
      `l'espace sous "${title}" (${gap.toFixed(1)}pt) diffère trop de celui sous "${gaps[0].title}" (${referenceGap.toFixed(1)}pt)`
    ).toBeLessThan(10);
  }
});
