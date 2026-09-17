import path from 'path';
import express from 'express';
import { readJson, writeJsonAtomic } from './store.js';

const isValidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const WORK_MODES = ['onsite', 'hybrid', 'remote'];
// Mirrors types.ts's SCRAPER_PORTAL_IDS — duplicated, not imported, same reason as
// WORK_MODES above (plain Node, no TS loader).
const SCRAPER_PORTAL_IDS = ['france_travail', 'arbeitnow', 'freehire', 'claude_cli'];

function errorBody(code, message) {
    return { error: { code, message } };
}

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
        franceTravailClientSecretConfigured: false,
        updatedAt: null,
    };
}

// The raw stored record (readJson(preferencesFilePath)) has a real
// franceTravailClientSecret field — this strips it out of anything sent over HTTP,
// replacing it with a boolean so the client can show "configured" without ever
// receiving the secret back. Used by both GET (read straight from disk) and PUT
// (echoing back what it just wrote).
function sanitizeForResponse(stored) {
    const { franceTravailClientSecret, ...rest } = stored;
    return { ...rest, franceTravailClientSecretConfigured: Boolean(franceTravailClientSecret) };
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
            res.json(sanitizeForResponse(await readJson(preferencesFilePath)));
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

        // Absent means "all enabled" (see types.ts SearchPreferences.enabledPortals) —
        // an empty array is a valid, if unusual, choice and not this handler's job to
        // block.
        let enabledPortals;
        if (body.enabledPortals !== undefined) {
            if (!Array.isArray(body.enabledPortals) || !body.enabledPortals.every((p) => SCRAPER_PORTAL_IDS.includes(p))) {
                return res
                    .status(400)
                    .json(errorBody('invalid_enabled_portals', `enabledPortals must be an array containing only: ${SCRAPER_PORTAL_IDS.join(', ')}`));
            }
            enabledPortals = [...new Set(body.enabledPortals)];
        }

        let searchBudgetUsd;
        if (body.searchBudgetUsd !== undefined && body.searchBudgetUsd !== null) {
            const n = Number(body.searchBudgetUsd);
            if (!Number.isFinite(n) || n < 0) {
                return res.status(400).json(errorBody('invalid_search_budget', 'searchBudgetUsd must be a non-negative number'));
            }
            searchBudgetUsd = n;
        }

        let autoDismissBelowScore;
        if (body.autoDismissBelowScore !== undefined && body.autoDismissBelowScore !== null) {
            const n = Number(body.autoDismissBelowScore);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
                return res.status(400).json(errorBody('invalid_auto_dismiss_score', 'autoDismissBelowScore must be a number between 0 and 100'));
            }
            autoDismissBelowScore = n;
        }

        let franceTravailClientId;
        if (typeof body.franceTravailClientId === 'string') {
            franceTravailClientId = body.franceTravailClientId.trim() || undefined;
        }

        // Write-only and NOT full-replace like every field above: GET never returns the
        // real secret (sanitizeForResponse), so the client has no value to round-trip.
        // Omitting this key entirely means "leave whatever's currently stored alone" —
        // otherwise every routine save (e.g. just editing job titles) would wipe it.
        // An explicit empty string is the one way to actually clear it.
        let franceTravailClientSecret;
        if (typeof body.franceTravailClientSecret === 'string') {
            franceTravailClientSecret = body.franceTravailClientSecret.trim() || undefined;
        } else {
            const existing = await readJson(preferencesFilePath).catch((err) => {
                if (err.code === 'ENOENT') return {};
                throw err;
            });
            franceTravailClientSecret = existing.franceTravailClientSecret;
        }

        const saved = {
            jobTitles: jobTitles.value,
            locations: locations.value,
            workModes: [...new Set(workModes)],
            minGrossAnnualSalary,
            cvId,
            enabledPortals,
            searchBudgetUsd,
            autoDismissBelowScore,
            franceTravailClientId,
            franceTravailClientSecret,
            updatedAt: new Date().toISOString(),
        };

        try {
            await writeJsonAtomic(preferencesFilePath, saved);
            res.json(sanitizeForResponse(saved));
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    return router;
}
