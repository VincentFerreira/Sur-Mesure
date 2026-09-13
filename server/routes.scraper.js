import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { listJsonFiles, readJson, writeJsonAtomic, deleteJson, ensureDir } from './store.js';
import { runScrape } from './scrapers/index.js';
import { makeDedupeKey } from './scraperDedupe.js';
import * as claudeCli from './scrapers/claudeCli.js';
import * as fake from './scrapers/fake.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const SCRAPED_JOB_STATUSES = ['new', 'dismissed', 'imported'];
const SCRAPED_JOB_FITS = ['high', 'medium', 'low'];

// Same "never make a real CLI call during the Vitest suite" rule as claude_cli's search
// portal (see server/scrapers/index.js's buildSingleShotRegistry) — plus an explicit
// opt-in (SCRAPER_PROVIDER=fake) for e2e/dev runs that want deterministic output without
// the `claude` binary installed/authenticated.
const useFakeAi = () => process.env.NODE_ENV === 'test' || process.env.SCRAPER_PROVIDER === 'fake';

function errorBody(code, message) {
    return { error: { code, message } };
}

function defaultPreferences() {
    return { jobTitles: [], locations: [], workModes: [], minGrossAnnualSalary: undefined, cvId: undefined, updatedAt: null };
}

async function readPreferences(preferencesFilePath) {
    try {
        return await readJson(preferencesFilePath);
    } catch (err) {
        if (err.code === 'ENOENT') return defaultPreferences();
        throw err;
    }
}

async function readAllCandidates(candidatesDir) {
    const files = await listJsonFiles(candidatesDir);
    return Promise.all(files.map((f) => readJson(path.join(candidatesDir, f))));
}

async function readAllJobs(jobsDir) {
    const files = await listJsonFiles(jobsDir);
    return Promise.all(files.map((f) => readJson(path.join(jobsDir, f))));
}

const normalize = (value) => (value ?? '').trim().toLowerCase();

export function createScraperRouter({ candidatesDir, jobsDir, preferencesFilePath }) {
    const router = express.Router();
    ensureDir(candidatesDir);

    router.get('/candidates', async (req, res) => {
        try {
            let candidates = await readAllCandidates(candidatesDir);
            const statuses = [].concat(req.query.status ?? []);
            if (statuses.length > 0) candidates = candidates.filter((c) => statuses.includes(c.status));
            candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            res.json(candidates);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Runs every enabled portal against the singleton SearchPreferences, dedupes
    // against both previously-seen candidates (by dedupeKey) and already-tracked Jobs
    // (by URL or normalized company+title) so a posting the user already has in their
    // pipeline never resurfaces as "new" — mirrors ai-job-search's seen_jobs.json dedup.
    //
    // Optional body.jobTitles overrides preferences.jobTitles for this run only (used
    // by the client to widen the search with AI-expanded keywords — see
    // POST /expand-keywords below — without persisting them into SearchPreferences
    // itself).
    router.post('/run', async (req, res) => {
        try {
            const preferences = await readPreferences(preferencesFilePath);
            const jobTitles =
                Array.isArray(req.body?.jobTitles) && req.body.jobTitles.length > 0 ? req.body.jobTitles : preferences.jobTitles;
            if (!jobTitles || jobTitles.length === 0) {
                return res
                    .status(400)
                    .json(errorBody('preferences_incomplete', 'Set at least one job title in Preferences before running a search.'));
            }

            const { results, portalReport } = await runScrape({
                jobTitles,
                locations: preferences.locations,
            });

            const existingCandidates = await readAllCandidates(candidatesDir);
            const existingKeys = new Set(existingCandidates.map((c) => c.dedupeKey));

            const existingJobs = await readAllJobs(jobsDir);
            const existingJobUrls = new Set(existingJobs.filter((j) => j.url).map((j) => j.url));
            const existingJobKeys = new Set(existingJobs.map((j) => `${normalize(j.company)}|${normalize(j.title)}`));

            const created = [];
            const now = new Date().toISOString();
            for (const item of results) {
                const dedupeKey = makeDedupeKey(item.company, item.title);
                if (existingKeys.has(dedupeKey)) continue;
                if (item.url && existingJobUrls.has(item.url)) continue;
                if (existingJobKeys.has(`${normalize(item.company)}|${normalize(item.title)}`)) continue;

                const candidate = {
                    id: randomUUID(),
                    dedupeKey,
                    portal: item.portal,
                    title: item.title,
                    company: item.company,
                    location: item.location,
                    contractType: item.contractType,
                    salaryRange: item.salaryRange,
                    url: item.url,
                    postedDate: item.postedDate,
                    descriptionRaw: item.descriptionRaw,
                    status: 'new',
                    firstSeenAt: now,
                    updatedAt: now,
                };
                await writeJsonAtomic(path.join(candidatesDir, `${candidate.id}.json`), candidate);
                existingKeys.add(dedupeKey);
                created.push(candidate);
            }

            res.json({ created, portalReport });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Widens a set of job titles into more search keywords before a scrape run, via the
    // `claude` CLI (server/scrapers/claudeCli.js) — no separate API key/rate limit, same
    // mechanism as the claude_cli search portal. Body: { jobTitles: string[] }. Response:
    // { jobTitles: string[] } — the combined, deduped list ready to send straight to
    // POST /run, not just the additions.
    router.post('/expand-keywords', async (req, res) => {
        const jobTitles = Array.isArray(req.body?.jobTitles) ? req.body.jobTitles : [];
        if (jobTitles.length === 0) return res.json({ jobTitles: [] });
        try {
            const expanded = useFakeAi() ? await fake.expandKeywords(jobTitles) : await claudeCli.expandKeywords(jobTitles);
            res.json({ jobTitles: expanded });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Judges each candidate's fit against the *original* (non-expanded) job titles/
    // locations, and optionally a CV text, via the `claude` CLI. Body: { candidates:
    // {id,title,company,location?,descriptionRaw?}[], jobTitles: string[], locations?:
    // string[], cvText?: string }. Response: { fitMap: Record<id, fit> } — missing ids
    // (a candidate the CLI couldn't judge) are simply absent, not an error.
    router.post('/qualify', async (req, res) => {
        const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
        const jobTitles = Array.isArray(req.body?.jobTitles) ? req.body.jobTitles : [];
        const locations = Array.isArray(req.body?.locations) ? req.body.locations : [];
        const cvText = typeof req.body?.cvText === 'string' ? req.body.cvText : undefined;
        if (candidates.length === 0 || jobTitles.length === 0) return res.json({ fitMap: {} });
        try {
            const fitMap = useFakeAi()
                ? await fake.qualifyAll(candidates, jobTitles, locations, cvText)
                : await claudeCli.qualifyAll(candidates, jobTitles, locations, cvText);
            res.json({ fitMap });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.patch('/candidates/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        const body = req.body ?? {};

        if (body.status !== undefined && !SCRAPED_JOB_STATUSES.includes(body.status)) {
            return res.status(400).json(errorBody('invalid_status', `status must be one of: ${SCRAPED_JOB_STATUSES.join(', ')}`));
        }
        if (body.fit !== undefined && !SCRAPED_JOB_FITS.includes(body.fit)) {
            return res.status(400).json(errorBody('invalid_fit', `fit must be one of: ${SCRAPED_JOB_FITS.join(', ')}`));
        }

        const filePath = path.join(candidatesDir, `${id}.json`);
        let existing;
        try {
            existing = await readJson(filePath);
        } catch {
            return res.status(404).json(errorBody('not_found', 'Scraped job not found'));
        }

        if (body.status === 'imported') {
            if (!body.importedJobId || !isValidId(body.importedJobId)) {
                return res.status(400).json(errorBody('invalid_imported_job_id', 'importedJobId must reference an existing job'));
            }
            try {
                await readJson(path.join(jobsDir, `${body.importedJobId}.json`));
            } catch {
                return res.status(400).json(errorBody('invalid_imported_job_id', 'importedJobId does not refer to an existing job'));
            }
        }

        const updated = {
            ...existing,
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.importedJobId !== undefined ? { importedJobId: body.importedJobId } : {}),
            ...(body.fit !== undefined ? { fit: body.fit } : {}),
            updatedAt: new Date().toISOString(),
        };

        try {
            await writeJsonAtomic(filePath, updated);
            res.json(updated);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.delete('/candidates/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        try {
            await readJson(path.join(candidatesDir, `${id}.json`));
        } catch {
            return res.status(404).json(errorBody('not_found', 'Scraped job not found'));
        }
        try {
            await deleteJson(path.join(candidatesDir, `${id}.json`));
            res.json({ success: true });
        } catch {
            res.status(404).json(errorBody('not_found', 'Scraped job not found'));
        }
    });

    return router;
}
