import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { listJsonFiles, readJson } from './store.js';
import {
    listCandidates,
    getCandidate,
    upsertSeenCandidate,
    markCandidatesViewed,
    updateCandidate,
    deleteCandidate,
    listRejectionReasons,
} from './scraperCandidatesStore.js';
import { runScrape } from './scrapers/index.js';
import { makeDedupeKey } from './scraperDedupe.js';
import { makeFingerprint } from './scraperFingerprint.js';
import { isLikelyRelevant } from './scraperRelevance.js';
import { startRun, endRun, getProgress } from './scraperProgress.js';
import { extractDepartment, isRemoteLocation, titleCaseIfAllCaps, companyOrFallback, decodeHtmlEntities } from './scraperNormalize.js';
import * as claudeCli from './scrapers/claudeCli.js';
import * as franceTravail from './scrapers/franceTravail.js';
import * as fake from './scrapers/fake.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const SCRAPED_JOB_STATUSES = ['new', 'dismissed', 'imported'];
const SCRAPED_JOB_FITS = ['high', 'medium', 'low'];
// Free-text, so no format validation beyond a length cap — bounds how much a single
// entry can inflate the "rejection memory" prompt claudeCli.qualifyAll builds from
// listRejectionReasons, regardless of how verbose one explanation gets.
const MAX_DISMISS_REASON_LENGTH = 300;
// How many recent, reasoned dismissals to feed into that prompt — see routes.scraper.js
// POST /qualify below and server/scraperCandidatesStore.js's listRejectionReasons.
const REJECTION_MEMORY_LIMIT = 30;

// Same "never make a real CLI call during the Vitest suite" rule as claude_cli's search
// portal (see server/scrapers/index.js's buildSingleShotRegistry) — plus an explicit
// opt-in (SCRAPER_PROVIDER=fake) for e2e/dev runs that want deterministic output without
// the `claude` binary installed/authenticated.
const useFakeAi = () => process.env.NODE_ENV === 'test' || process.env.SCRAPER_PROVIDER === 'fake';

function errorBody(code, message) {
    return { error: { code, message } };
}

// Mirrors types.ts's SCRAPER_PORTAL_IDS — duplicated, not imported, same reason as
// SCRAPED_JOB_STATUSES above (plain Node, no TS loader).
const SCRAPER_PORTAL_IDS = ['france_travail', 'arbeitnow', 'freehire', 'claude_cli'];

function defaultPreferences() {
    return {
        jobTitles: [],
        locations: [],
        workModes: [],
        minGrossAnnualSalary: undefined,
        cvId: undefined,
        enabledPortals: [...SCRAPER_PORTAL_IDS],
        searchBudgetUsd: undefined,
        autoDismissBelowScore: undefined,
        franceTravailClientId: undefined,
        franceTravailClientSecret: undefined,
        updatedAt: null,
    };
}

async function readPreferences(preferencesFilePath) {
    try {
        return await readJson(preferencesFilePath);
    } catch (err) {
        if (err.code === 'ENOENT') return defaultPreferences();
        throw err;
    }
}

async function readAllJobs(jobsDir) {
    const files = await listJsonFiles(jobsDir);
    return Promise.all(files.map((f) => readJson(path.join(jobsDir, f))));
}

const normalize = (value) => (value ?? '').trim().toLowerCase();

const SCRAPED_SIGNAL_POLARITIES = ['positive', 'negative', 'neutral'];
const isValidSignals = (signals) =>
    Array.isArray(signals) &&
    signals.every((s) => s && typeof s.label === 'string' && SCRAPED_SIGNAL_POLARITIES.includes(s.polarity));

export function createScraperRouter({ candidatesDb, jobsDir, preferencesFilePath }) {
    const router = express.Router();

    router.get('/candidates', async (req, res) => {
        try {
            const statuses = [].concat(req.query.status ?? []);
            res.json(listCandidates(candidatesDb, statuses));
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Runs every enabled portal against the singleton SearchPreferences, dedupes
    // against both previously-seen candidates (by dedupeKey) and already-tracked Jobs
    // (by URL or normalized company+title) so a posting the user already has in their
    // pipeline never resurfaces as "new" — mirrors ai-job-search's seen_jobs.json dedup.
    // Also drops results with zero word overlap against jobTitles (scraperRelevance.js)
    // before they're stored — cuts obviously off-topic noise before it costs a slot in
    // a later claudeCli.qualifyAll batch; counted per-portal in the response's
    // `filteredCounts`, separately from `portalReport`'s raw per-portal fetch counts.
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

            // Scoped to the portal fan-out (which is where claudeCli.searchAll's slow,
            // narratable WebSearch/WebFetch tool calls happen) rather than the whole
            // handler — persistence below is fast and has nothing to narrate, so
            // GET /run/progress's `active` flips false as soon as there's nothing left
            // worth polling for. startRun() also clears any stale events from a
            // previous run.
            startRun();
            // In-app credentials (SearchPreferences.franceTravailClientId/_ClientSecret)
            // take priority over FRANCE_TRAVAIL_CLIENT_ID/_SECRET env vars when set — see
            // franceTravail.js's configureCredentials. Always called, even with both
            // undefined, so a credential cleared via Preferences actually stops being
            // used instead of the module still holding a stale override from an earlier run.
            franceTravail.configureCredentials(preferences.franceTravailClientId, preferences.franceTravailClientSecret);
            let results, portalReport;
            try {
                ({ results, portalReport } = await runScrape({
                    jobTitles,
                    locations: preferences.locations,
                    enabledPortalIds: preferences.enabledPortals,
                    searchBudgetUsd: preferences.searchBudgetUsd,
                }));
            } finally {
                endRun();
            }

            const existingJobs = await readAllJobs(jobsDir);
            const existingJobUrls = new Set(existingJobs.filter((j) => j.url).map((j) => j.url));
            const existingJobKeys = new Set(existingJobs.map((j) => `${normalize(j.company)}|${normalize(j.title)}`));

            const created = [];
            const filteredCounts = {};
            const now = new Date().toISOString();
            for (const item of results) {
                if (item.url && existingJobUrls.has(item.url)) continue;
                if (existingJobKeys.has(`${normalize(item.company)}|${normalize(item.title)}`)) continue;

                // Decoded once up front: some portals (seen on France Travail) send literal
                // HTML entities ("&amp;") in title/company/location/description rather than
                // decoded text. Both `dedupeKey` (vestigial, see scraperCandidatesStore.js)
                // and `fingerprint` (the real identity now) are computed from these decoded
                // values below.
                const decodedLocation = decodeHtmlEntities(item.location);
                const decodedCompany = decodeHtmlEntities(item.company);
                const decodedTitle = decodeHtmlEntities(item.title);
                const decodedDescription = decodeHtmlEntities(item.descriptionRaw);
                const department = extractDepartment(decodedLocation);

                // Anti-noise pre-filter: a result sharing no word at all with any target
                // job title is almost certainly a different job family — drop it before it
                // costs a stored row and, later, a slot in a claudeCli.qualifyAll batch.
                // Never stored, so it can't even be counted as a re-seen duplicate.
                if (!isLikelyRelevant({ title: decodedTitle, descriptionRaw: decodedDescription }, jobTitles)) {
                    filteredCounts[item.portal] = (filteredCounts[item.portal] ?? 0) + 1;
                    continue;
                }

                const candidate = {
                    id: randomUUID(),
                    dedupeKey: makeDedupeKey(item.company, item.title),
                    // Computed from the decoded-but-not-fallback-substituted company/title —
                    // using companyOrFallback's synthetic "Offre X" text here would make two
                    // genuinely-different anonymous postings from the same portal MORE likely
                    // to collide, not less.
                    fingerprint: makeFingerprint({ portal: item.portal, externalId: item.externalId, company: decodedCompany, title: decodedTitle, department }),
                    externalId: item.externalId,
                    portal: item.portal,
                    title: titleCaseIfAllCaps(decodedTitle),
                    company: companyOrFallback(decodedCompany, item.portal),
                    location: decodedLocation,
                    department,
                    isRemote: isRemoteLocation(decodedLocation),
                    contractType: item.contractType,
                    salaryRange: item.salaryRange,
                    url: item.url,
                    postedDate: item.postedDate,
                    descriptionRaw: decodedDescription,
                    status: 'new',
                    firstSeenAt: now,
                    lastSeenAt: now,
                    updatedAt: now,
                };
                // `created` keeps meaning exactly "genuinely new insert" — a re-seen
                // fingerprint only gets its last_seen_at touched (status/viewedAt untouched,
                // see upsertSeenCandidate) and is never pushed here.
                const { isNew } = upsertSeenCandidate(candidatesDb, candidate);
                if (isNew) created.push(candidate);
            }

            res.json({ created, portalReport, filteredCounts });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Live feedback for the in-flight POST /run above — the client polls this every
    // couple seconds while that request is outstanding (see store/scraperStore.ts) to
    // show what claudeCli.searchAll is actually doing (which query, which URL, success
    // or failure) instead of a static spinner for what can take several minutes.
    // `sinceSeq` mirrors GET /observability/calls's sinceRowId: only events newer than
    // the last one the client already has are returned.
    router.get('/run/progress', (req, res) => {
        const sinceSeq = req.query.sinceSeq ? Number(req.query.sinceSeq) : 0;
        res.json(getProgress(sinceSeq));
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
    // locations/work modes, and optionally a CV text, via the `claude` CLI. Body:
    // { candidates: {id,title,company,location?,descriptionRaw?}[], jobTitles: string[],
    // locations?: string[], workModes?: JobWorkMode[], cvText?: string }. Response:
    // { results: Record<id, {fit,score,signals}> } — missing ids (a candidate the CLI
    // couldn't judge) are simply absent, not an error.
    //
    // Also loads the user's own past rejection reasons (listRejectionReasons) and passes
    // them along as "rejection memory" — the whole point of capturing a reason on
    // dismiss (PATCH /candidates/:id below) is to let this step score a similar future
    // posting lower instead of surfacing it unfiltered again.
    router.post('/qualify', async (req, res) => {
        const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
        const jobTitles = Array.isArray(req.body?.jobTitles) ? req.body.jobTitles : [];
        const locations = Array.isArray(req.body?.locations) ? req.body.locations : [];
        const workModes = Array.isArray(req.body?.workModes) ? req.body.workModes : [];
        const cvText = typeof req.body?.cvText === 'string' ? req.body.cvText : undefined;
        if (candidates.length === 0 || jobTitles.length === 0) return res.json({ results: {} });
        try {
            const rejectionMemory = listRejectionReasons(candidatesDb, { limit: REJECTION_MEMORY_LIMIT });
            const preferences = await readPreferences(preferencesFilePath);
            const results = useFakeAi()
                ? await fake.qualifyAll(candidates, jobTitles, locations, cvText, workModes, rejectionMemory, preferences.autoDismissBelowScore)
                : await claudeCli.qualifyAll(candidates, jobTitles, locations, cvText, workModes, rejectionMemory, preferences.autoDismissBelowScore);
            res.json({ results });
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
        if (body.score !== undefined && (typeof body.score !== 'number' || body.score < 0 || body.score > 100)) {
            return res.status(400).json(errorBody('invalid_score', 'score must be a number between 0 and 100'));
        }
        if (body.signals !== undefined && !isValidSignals(body.signals)) {
            return res.status(400).json(errorBody('invalid_signals', 'signals must be an array of {label, polarity}'));
        }
        if (body.dismissReason !== undefined && (typeof body.dismissReason !== 'string' || body.dismissReason.length > MAX_DISMISS_REASON_LENGTH)) {
            return res
                .status(400)
                .json(errorBody('invalid_dismiss_reason', `dismissReason must be a string of at most ${MAX_DISMISS_REASON_LENGTH} characters`));
        }

        const existing = getCandidate(candidatesDb, id);
        if (!existing) {
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
            ...(body.score !== undefined ? { score: body.score } : {}),
            ...(body.signals !== undefined ? { signals: body.signals } : {}),
            ...(body.dismissReason !== undefined ? { dismissReason: body.dismissReason } : {}),
            updatedAt: new Date().toISOString(),
        };

        try {
            updateCandidate(candidatesDb, updated);
            res.json(updated);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Marks the given candidates as viewed for the first time (idempotent — an
    // already-viewed id is left untouched). Body: { ids: string[] }. Used both for a
    // single row (IntersectionObserver fires this with one id) and the bulk "Tout
    // marquer comme vu" toolbar button (fires it with every currently-visible unviewed
    // id) — one endpoint, not two, since the only difference is how many ids are sent.
    router.post('/candidates/mark-viewed', async (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isValidId) : [];
        try {
            const count = markCandidatesViewed(candidatesDb, ids);
            res.json({ success: true, count });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.delete('/candidates/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        try {
            const deleted = deleteCandidate(candidatesDb, id);
            if (!deleted) return res.status(404).json(errorBody('not_found', 'Scraped job not found'));
            res.json({ success: true });
        } catch {
            res.status(404).json(errorBody('not_found', 'Scraped job not found'));
        }
    });

    return router;
}
