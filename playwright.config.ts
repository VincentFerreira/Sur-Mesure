import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Isolated data dir for the server this config spawns itself — keeps e2e runs from
// reading/writing the developer's real CVs and jobs under ./data (also sidesteps that
// directory sometimes being root-owned from Docker use, which a real host user can't
// write into). Irrelevant when reuseExistingServer reuses an already-running instance,
// since then this env block is never applied.
const E2E_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'yarb-e2e-data-'));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        // Exposes the deterministic, offline "Fake" ATS provider in the UI so scoring
        // e2e scenarios never depend on a real LLM call. Only applies when this config
        // spawns its own Vite dev server (see YARB_TEST_HOOKS note below).
        VITE_ATS_PROVIDER: 'fake',
      },
    },
    {
      command: 'npm run server',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        // server.js defaults to a macOS MacTeX path; point it at the
        // Linux pdflatex binary for local dev and CI alike.
        PDFLATEX_PATH: process.env.PDFLATEX_PATH ?? '/usr/bin/pdflatex',
        // Only takes effect when Playwright spawns this server itself (CI, or no
        // dev server already listening) — never touches an already-running,
        // reused instance, so it can't expose the reset/seed hooks on a live deployment.
        YARB_TEST_HOOKS: '1',
        YARB_DATA_DIR: E2E_DATA_DIR,
        // Registers the deterministic, offline `fake` portal in the scraper registry
        // (server/scrapers/index.js) so job-search e2e scenarios never depend on
        // France Travail credentials or network access.
        SCRAPER_PROVIDER: 'fake',
      },
    },
  ],
});
