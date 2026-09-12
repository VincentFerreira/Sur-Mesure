import path from 'path';
import express from 'express';
import { readJson, writeJsonAtomic } from './store.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const WORK_MODES = ['onsite', 'hybrid', 'remote'];

function errorBody(code, message) {
    return { error: { code, message } };
}

function defaultPreferences() {
    return { jobTitles: [], locations: [], workModes: [], minGrossAnnualSalary: undefined, cvId: undefined, updatedAt: null };
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

// Trims, drops empties, and dedupes exact-string duplicates only — jobTitles/locations
// are free-text scraper hints where casing can carry meaning ("Remote" vs "remote
// France" aren't the same intent), unlike an identity-bearing field like Company.name.
function normalizeStringList(value) {
    if (value === undefined) return { ok: true, value: [] };
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return { ok: false };
    const seen = new Set();
    const out = [];
    for (const raw of value) {
        const v = raw.trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return { ok: true, value: out };
}

export function createPreferencesRouter({ preferencesFilePath, cvsDir }) {
    const router = express.Router();

    // No POST/DELETE: this singleton always "exists" conceptually. Resetting means
    // PUT-ing an empty shape — a dedicated endpoint would do nothing PUT can't.
    router.get('/', async (req, res) => {
        try {
            res.json(await readJson(preferencesFilePath));
        } catch (err) {
            if (err.code === 'ENOENT') return res.json(defaultPreferences());
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.put('/', async (req, res) => {
        const body = req.body ?? {};

        const jobTitles = normalizeStringList(body.jobTitles);
        if (!jobTitles.ok) return res.status(400).json(errorBody('invalid_job_titles', 'jobTitles must be an array of strings'));

        const locations = normalizeStringList(body.locations);
        if (!locations.ok) return res.status(400).json(errorBody('invalid_locations', 'locations must be an array of strings'));

        const workModes = body.workModes ?? [];
        if (!Array.isArray(workModes) || !workModes.every((m) => WORK_MODES.includes(m))) {
            return res.status(400).json(errorBody('invalid_work_modes', `workModes must be an array containing only: ${WORK_MODES.join(', ')}`));
        }

        let minGrossAnnualSalary;
        if (body.minGrossAnnualSalary !== undefined && body.minGrossAnnualSalary !== null) {
            const n = Number(body.minGrossAnnualSalary);
            if (!Number.isFinite(n) || n < 0) {
                return res.status(400).json(errorBody('invalid_salary', 'minGrossAnnualSalary must be a non-negative number'));
            }
            minGrossAnnualSalary = n;
        }

        let cvId;
        if (body.cvId) {
            if (!(await cvExists(cvsDir, body.cvId))) {
                return res.status(400).json(errorBody('invalid_cv_id', 'cvId does not refer to an existing CV'));
            }
            cvId = body.cvId;
        }

        const saved = {
            jobTitles: jobTitles.value,
            locations: locations.value,
            workModes: [...new Set(workModes)],
            minGrossAnnualSalary,
            cvId,
            updatedAt: new Date().toISOString(),
        };

        try {
            await writeJsonAtomic(preferencesFilePath, saved);
            res.json(saved);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    return router;
}
