import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { listJsonFiles, readJson, writeJsonAtomic, deleteJson, ensureDir } from './store.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];

function errorBody(code, message) {
    return { error: { code, message } };
}

async function readAllCompanies(companiesDir) {
    const files = await listJsonFiles(companiesDir);
    return Promise.all(files.map((f) => readJson(path.join(companiesDir, f))));
}

async function readAllJobs(jobsDir) {
    const files = await listJsonFiles(jobsDir);
    return Promise.all(files.map((f) => readJson(path.join(jobsDir, f))));
}

const normalize = (name) => name.trim().toLowerCase();

async function findByNormalizedName(companiesDir, name) {
    const companies = await readAllCompanies(companiesDir);
    return companies.find((c) => normalize(c.name) === normalize(name));
}

// Links any pre-existing Job whose free-text `company` matches this Company's name
// (case-insensitive/trimmed) and that isn't linked to a company yet. Called on every
// create path (and on rename) so Jobs entered before this Company existed get picked
// up automatically instead of requiring a manual link step. Idempotent.
async function backfillJobLinks(jobsDir, company) {
    const files = await listJsonFiles(jobsDir);
    for (const f of files) {
        const filePath = path.join(jobsDir, f);
        const job = await readJson(filePath);
        if (!job.companyId && job.company && normalize(job.company) === normalize(company.name)) {
            await writeJsonAtomic(filePath, { ...job, companyId: company.id, updatedAt: new Date().toISOString() });
        }
    }
}

function validateBody(body) {
    if (!body.name || !body.name.trim()) return 'name is required';
    if (body.size !== undefined && body.size !== null && !COMPANY_SIZES.includes(body.size)) {
        return `size must be one of: ${COMPANY_SIZES.join(', ')}`;
    }
    return null;
}

export function createCompaniesRouter({ companiesDir, jobsDir }) {
    const router = express.Router();
    ensureDir(companiesDir);

    router.get('/', async (req, res) => {
        try {
            let companies = await readAllCompanies(companiesDir);
            const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
            if (q) companies = companies.filter((c) => c.name.toLowerCase().includes(q));
            companies.sort((a, b) => a.name.localeCompare(b.name));
            res.json(companies);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Idempotent by normalized name: re-submitting a name that already exists returns
    // the existing record (200) instead of erroring or creating a duplicate, so both
    // "+ New company" and re-pasting a bulk list are safe to repeat.
    router.post('/', async (req, res) => {
        const body = req.body ?? {};
        const validationError = validateBody(body);
        if (validationError) return res.status(400).json(errorBody('invalid_body', validationError));

        try {
            const existing = await findByNormalizedName(companiesDir, body.name);
            if (existing) {
                await backfillJobLinks(jobsDir, existing);
                return res.json(existing);
            }

            const now = new Date().toISOString();
            const company = {
                id: randomUUID(),
                name: body.name.trim(),
                website: body.website,
                location: body.location,
                size: body.size,
                remoteFriendly: body.remoteFriendly,
                next40: body.next40,
                frenchTech120: body.frenchTech120,
                notes: body.notes,
                createdAt: now,
                updatedAt: now,
            };
            await writeJsonAtomic(path.join(companiesDir, `${company.id}.json`), company);
            await backfillJobLinks(jobsDir, company);
            res.json(company);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Bulk create from a flat list of names. Never errors on individual dupes — returns
    // which names were newly created vs. already existed (matched case-insensitively),
    // so the client can show "N created, M already existed".
    router.post('/bulk', async (req, res) => {
        const names = Array.isArray(req.body?.names) ? req.body.names : null;
        if (!names || names.length === 0) {
            return res.status(400).json(errorBody('invalid_body', 'names must be a non-empty array of strings'));
        }
        const trimmed = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
        if (trimmed.length === 0) {
            return res.status(400).json(errorBody('invalid_body', 'names must contain at least one non-empty value'));
        }

        try {
            const existingCompanies = await readAllCompanies(companiesDir);
            const existingByName = new Map(existingCompanies.map((c) => [normalize(c.name), c]));

            const created = [];
            const skipped = [];
            const now = new Date().toISOString();
            for (const name of trimmed) {
                const key = normalize(name);
                if (existingByName.has(key)) {
                    skipped.push(name);
                    continue;
                }
                const company = { id: randomUUID(), name, createdAt: now, updatedAt: now };
                await writeJsonAtomic(path.join(companiesDir, `${company.id}.json`), company);
                await backfillJobLinks(jobsDir, company);
                existingByName.set(key, company);
                created.push(company);
            }

            res.json({ created, skipped });
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.patch('/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        const body = req.body ?? {};
        if (body.size !== undefined && body.size !== null && !COMPANY_SIZES.includes(body.size)) {
            return res.status(400).json(errorBody('invalid_size', `size must be one of: ${COMPANY_SIZES.join(', ')}`));
        }

        const filePath = path.join(companiesDir, `${id}.json`);
        let existing;
        try {
            existing = await readJson(filePath);
        } catch {
            return res.status(404).json(errorBody('not_found', 'Company not found'));
        }

        const now = new Date().toISOString();
        const updated = { ...existing, ...body, updatedAt: now };
        try {
            await writeJsonAtomic(filePath, updated);
            if (body.name && normalize(body.name) !== normalize(existing.name)) {
                await backfillJobLinks(jobsDir, updated);
            }
            res.json(updated);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.delete('/:id', async (req, res) => {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json(errorBody('invalid_id', 'Invalid ID'));
        try {
            await readJson(path.join(companiesDir, `${id}.json`));
        } catch {
            return res.status(404).json(errorBody('not_found', 'Company not found'));
        }

        const jobs = await readAllJobs(jobsDir);
        if (jobs.some((j) => j.companyId === id)) {
            return res
                .status(409)
                .json(errorBody('company_in_use', 'This company is linked to one or more jobs and cannot be deleted.'));
        }

        try {
            await deleteJson(path.join(companiesDir, `${id}.json`));
            res.json({ success: true });
        } catch {
            res.status(404).json(errorBody('not_found', 'Company not found'));
        }
    });

    return router;
}
