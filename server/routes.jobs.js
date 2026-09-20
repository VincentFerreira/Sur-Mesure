import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { listJsonFiles, readJson, writeJsonAtomic, deleteJson, ensureDir } from './store.js';
import { sha256Json } from './hash.js';
import * as claudeCli from './scrapers/claudeCli.js';
import * as fake from './scrapers/fake.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const useFakeAi = () => process.env.NODE_ENV === 'test' || process.env.SCRAPER_PROVIDER === 'fake';

const JOB_STATUSES = ['lead', 'to_apply', 'applied', 'screening', 'interview', 'offer', 'rejected', 'archived'];
const EVENT_TYPES = ['status_change', 'note', 'follow_up', 'interview', 'match_submitted'];
// Mirrors types.ts's APPLICATION_TEXT_TYPES — duplicated rather than imported (plain
// Node, no TS loader), same convention as JOB_STATUSES above.
const APPLICATION_TEXT_TYPES = ['quick_pitch', 'full_pitch', 'referral_message'];

function errorBody(code, message) {
    return { error: { code, message } };
}

async function readAllJobs(jobsDir) {
    const files = await listJsonFiles(jobsDir);
    return Promise.all(files.map((f) => readJson(path.join(jobsDir, f))));
}

async function cvExists(cvsDir, cvId) {
    if (!isValidId(cvId)) return false;
    try {
        await readJson(path.join(cvsDir, `${cvId}.json`));
        return true;
    } catch {
        return false;
    }
}

export function createJobsRouter({ jobsDir, cvsDir }) {
    const router = express.Router();
    ensureDir(jobsDir);

    router.get('/', async (req, res) => {
        try {
            let jobs = await readAllJobs(jobsDir);

            const statusFilter = [].concat(req.query.status ?? []);
            if (statusFilter.length > 0) {
                jobs = jobs.filter((j) => statusFilter.includes(j.status));
            }

            const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
            if (q) {
                jobs = jobs.filter(
                    (j) => j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q)
                );
            }

            const sort = req.query.sort ?? 'nextActionAt';
            jobs.sort((a, b) => {
                if (sort === 'priority') return a.priority - b.priority;
                if (sort === 'updatedAt') return b.updatedAt.localeCompare(a.updatedAt);
                // default: nextActionAt ascending, jobs without one sort last, tie-broken by priority.
                if (!a.nextActionAt && !b.nextActionAt) return a.priority - b.priority;
                if (!a.nextActionAt) return 1;
                if (!b.nextActionAt) return -1;
                return a.nextActionAt.localeCompare(b.nextActionAt) || a.priority - b.priority;
            });

            res.json(jobs);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.get('/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        try {
            res.json(await readJson(path.join(jobsDir, `${id}.json`)));
        } catch {
            res.status(404).json(errorBody('not_found', 'Job not found'));
        }
    });

    router.post('/', async (req, res) => {
        const body = req.body ?? {};
        const { company, title, descriptionRaw } = body;
        if (!company || !title || !descriptionRaw) {
            return res.status(400).json(errorBody('invalid_body', 'company, title and descriptionRaw are required'));
        }
        if (body.status !== undefined && !JOB_STATUSES.includes(body.status)) {
            return res.status(400).json(errorBody('invalid_status', `status must be one of: ${JOB_STATUSES.join(', ')}`));
        }
        if (body.priority !== undefined && ![1, 2, 3].includes(body.priority)) {
            return res.status(400).json(errorBody('invalid_priority', 'priority must be 1, 2 or 3'));
        }
        if (body.status === 'applied' && !body.cvId) {
            return res.status(409).json(errorBody('cv_required_for_applied', 'A status of "applied" requires cvId to be set'));
        }
        if (body.cvId && !(await cvExists(cvsDir, body.cvId))) {
            return res.status(400).json(errorBody('invalid_cv_id', 'cvId does not refer to an existing CV'));
        }

        const now = new Date().toISOString();
        const job = {
            id: randomUUID(),
            company,
            title,
            status: body.status ?? 'lead',
            priority: body.priority ?? 2,
            location: body.location,
            workMode: body.workMode,
            contractType: body.contractType,
            salaryRange: body.salaryRange,
            url: body.url,
            source: body.source,
            contactName: body.contactName,
            descriptionRaw,
            keywords: Array.isArray(body.keywords) ? body.keywords : [],
            cvId: body.cvId,
            submitted: false,
            notes: body.notes,
            nextActionAt: body.nextActionAt,
            nextActionLabel: body.nextActionLabel,
            events: [],
            createdAt: now,
            updatedAt: now,
        };
        if (job.status === 'applied') job.appliedAt = now;

        try {
            await writeJsonAtomic(path.join(jobsDir, `${job.id}.json`), job);
            res.json(job);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.patch('/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        const body = req.body ?? {};

        if (body.status !== undefined && !JOB_STATUSES.includes(body.status)) {
            return res.status(400).json(errorBody('invalid_status', `status must be one of: ${JOB_STATUSES.join(', ')}`));
        }
        if (body.priority !== undefined && ![1, 2, 3].includes(body.priority)) {
            return res.status(400).json(errorBody('invalid_priority', 'priority must be 1, 2 or 3'));
        }

        const filePath = path.join(jobsDir, `${id}.json`);
        let existing;
        try {
            existing = await readJson(filePath);
        } catch {
            return res.status(404).json(errorBody('not_found', 'Job not found'));
        }

        const nextStatus = body.status ?? existing.status;
        const nextCvId = body.cvId !== undefined ? body.cvId : existing.cvId;
        if (nextStatus === 'applied' && !nextCvId) {
            return res.status(409).json(errorBody('cv_required_for_applied', 'A status of "applied" requires cvId to be set'));
        }
        if (body.cvId && !(await cvExists(cvsDir, body.cvId))) {
            return res.status(400).json(errorBody('invalid_cv_id', 'cvId does not refer to an existing CV'));
        }

        const now = new Date().toISOString();
        const updated = { ...existing, ...body, updatedAt: now };

        if (body.status !== undefined && body.status !== existing.status) {
            updated.events = [
                ...existing.events,
                { id: randomUUID(), at: now, type: 'status_change', from: existing.status, to: body.status },
            ];
            if (body.status === 'applied' && !updated.appliedAt) updated.appliedAt = now;
        }

        if (body.submitted === true && existing.submitted !== true) {
            if (!updated.submittedAt) updated.submittedAt = now;
            updated.events = [
                ...(updated.events ?? existing.events),
                { id: randomUUID(), at: now, type: 'match_submitted' },
            ];
        }

        try {
            await writeJsonAtomic(filePath, updated);
            res.json(updated);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.delete('/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        try {
            await deleteJson(path.join(jobsDir, `${id}.json`));
            res.json({ success: true });
        } catch {
            res.status(404).json(errorBody('not_found', 'Job not found'));
        }
    });

    router.post('/:id/events', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        const { type, comment, from, to } = req.body ?? {};
        if (!EVENT_TYPES.includes(type)) {
            return res.status(400).json(errorBody('invalid_event_type', `type must be one of: ${EVENT_TYPES.join(', ')}`));
        }

        const filePath = path.join(jobsDir, `${id}.json`);
        try {
            const existing = await readJson(filePath);
            const now = new Date().toISOString();
            const event = { id: randomUUID(), at: now, type, ...(comment ? { comment } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
            const updated = { ...existing, events: [...existing.events, event], updatedAt: now };
            await writeJsonAtomic(filePath, updated);
            res.json(updated);
        } catch {
            res.status(404).json(errorBody('not_found', 'Job not found'));
        }
    });

    router.post('/:id/score', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        const { cvId, cvContentHash, ats } = req.body ?? {};
        if (!cvId || !cvContentHash || !ats) {
            return res.status(400).json(errorBody('invalid_body', 'cvId, cvContentHash and ats are required'));
        }
        if (!(await cvExists(cvsDir, cvId))) {
            return res.status(400).json(errorBody('invalid_cv_id', 'cvId does not refer to an existing CV'));
        }

        const filePath = path.join(jobsDir, `${id}.json`);
        try {
            const existing = await readJson(filePath);
            const now = new Date().toISOString();
            const updated = {
                ...existing,
                cvId,
                cvContentHash,
                ats: { ...ats, jobDescriptionHash: sha256Json(existing.descriptionRaw) },
                atsComputedAt: now,
                updatedAt: now,
            };
            await writeJsonAtomic(filePath, updated);
            res.json(updated);
        } catch {
            res.status(404).json(errorBody('not_found', 'Job not found'));
        }
    });

    // AI-generated application text (quick pitch / full pitch / referral message) via
    // the `claude` CLI (server/scrapers/claudeCli.js) — same mechanism as job-search
    // qualification, no separate billed API key. Body: { textType, cvText }. cvText is
    // computed client-side (loadCV + serializeCVForATS, mirroring handleComputeScore
    // and handleRunSearch) rather than the server re-reading CV storage itself — job
    // title/company/description and any existing ATS result are read straight off the
    // already-stored job record. Response: { text }.
    router.post('/:id/generate-application-text', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));

        const { textType, cvText } = req.body ?? {};
        if (!APPLICATION_TEXT_TYPES.includes(textType)) {
            return res.status(400).json(errorBody('invalid_text_type', `textType must be one of: ${APPLICATION_TEXT_TYPES.join(', ')}`));
        }
        if (typeof cvText !== 'string' || cvText.trim().length === 0) {
            return res.status(400).json(errorBody('invalid_body', 'cvText is required'));
        }

        let job;
        try {
            job = await readJson(path.join(jobsDir, `${id}.json`));
        } catch {
            return res.status(404).json(errorBody('not_found', 'Job not found'));
        }

        const atsContext = buildAtsContext(job.ats);
        try {
            const text = useFakeAi()
                ? await fake.generateApplicationText(job.title, job.company, job.descriptionRaw, cvText, textType)
                : await claudeCli.generateApplicationText(job.title, job.company, job.descriptionRaw, cvText, textType, atsContext);
            res.json({ text });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    return router;
}

// Condensed digest of an already-computed ATS result, passed as extra grounding to
// generateApplicationText — not required (undefined when the job has no `ats` yet, or
// its analysis is missing keyword arrays), the prompt works from cvText/descriptionRaw
// alone in that case.
function buildAtsContext(ats) {
    const analysis = ats?.analysis;
    if (!analysis) return undefined;
    const matched = [...(analysis.criticalKeywords ?? []), ...(analysis.importantKeywords ?? [])]
        .filter((k) => k.status === 'present' || k.status === 'partial')
        .map((k) => k.keyword);
    const parts = [];
    if (matched.length > 0) parts.push(`Matched keywords: ${matched.join(', ')}`);
    if (analysis.summary) parts.push(`ATS summary: ${analysis.summary}`);
    return parts.length > 0 ? parts.join('\n') : undefined;
}
