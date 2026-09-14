import fsp from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from './store.js';
import { upsertCandidateRaw } from './scraperCandidatesStore.js';

// Test-only endpoints for Playwright/integration setup. Never registered
// outside test runs, so they can't be hit in a real deployment.
export function testHooksEnabled() {
    return process.env.NODE_ENV === 'test' || process.env.YARB_TEST_HOOKS === '1';
}

// Note: /api/__test__/reset below still wipes `dataDir` recursively, which would
// delete the scraper-candidates .sqlite file out from under a *live* server's
// already-open `candidatesDb` handle. Not fixed here: `reset` is never called against
// a real running server in this codebase (grep-verified) — only inside
// __tests__/server/testHooks.test.ts's own short-lived, throwaway app, which opens a
// fresh candidatesDb per test and never asserts anything about scraper-candidates
// across a reset.
export function registerTestHooks(app, { dataDir, candidatesDb }) {
    if (!testHooksEnabled()) return;

    app.post('/api/__test__/reset', async (_req, res) => {
        await fsp.rm(dataDir, { recursive: true, force: true });
        await fsp.mkdir(path.join(dataDir, 'cvs'), { recursive: true });
        res.json({ success: true });
    });

    app.post('/api/__test__/seed', async (req, res) => {
        const { cvs = [], scrapedJobs = [], jobs = [] } = req.body ?? {};
        await fsp.mkdir(path.join(dataDir, 'cvs'), { recursive: true });
        for (const cv of cvs) {
            await writeJsonAtomic(path.join(dataDir, 'cvs', `${cv.id}.json`), cv);
        }
        for (const candidate of scrapedJobs) {
            upsertCandidateRaw(candidatesDb, candidate);
        }
        // Writes Job records directly to disk, bypassing the PATCH /api/jobs/:id path
        // that normally auto-appends status_change events at `now` — this is the only
        // way to seed a job with `events` at deliberately spaced timestamps, needed for
        // the Analyse page's pipeline-funnel duration metrics (see lib/insightsFunnel.ts).
        if (jobs.length > 0) {
            await fsp.mkdir(path.join(dataDir, 'jobs'), { recursive: true });
            for (const job of jobs) {
                await writeJsonAtomic(path.join(dataDir, 'jobs', `${job.id}.json`), job);
            }
        }
        res.json({ success: true, seeded: { cvs: cvs.length, scrapedJobs: scrapedJobs.length, jobs: jobs.length } });
    });
}
