import fsp from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from './store.js';

// Test-only endpoints for Playwright/integration setup. Never registered
// outside test runs, so they can't be hit in a real deployment.
export function testHooksEnabled() {
    return process.env.NODE_ENV === 'test' || process.env.YARB_TEST_HOOKS === '1';
}

export function registerTestHooks(app, { dataDir }) {
    if (!testHooksEnabled()) return;

    app.post('/api/__test__/reset', async (_req, res) => {
        await fsp.rm(dataDir, { recursive: true, force: true });
        await fsp.mkdir(path.join(dataDir, 'cvs'), { recursive: true });
        res.json({ success: true });
    });

    app.post('/api/__test__/seed', async (req, res) => {
        const { cvs = [], scrapedJobs = [] } = req.body ?? {};
        await fsp.mkdir(path.join(dataDir, 'cvs'), { recursive: true });
        for (const cv of cvs) {
            await writeJsonAtomic(path.join(dataDir, 'cvs', `${cv.id}.json`), cv);
        }
        if (scrapedJobs.length > 0) {
            await fsp.mkdir(path.join(dataDir, 'scraper-candidates'), { recursive: true });
            for (const candidate of scrapedJobs) {
                await writeJsonAtomic(path.join(dataDir, 'scraper-candidates', `${candidate.id}.json`), candidate);
            }
        }
        res.json({ success: true, seeded: { cvs: cvs.length, scrapedJobs: scrapedJobs.length } });
    });
}
