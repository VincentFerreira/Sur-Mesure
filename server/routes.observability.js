import express from 'express';
import { randomUUID } from 'crypto';
import { insertCall, listCalls, getStats, getCallDetail } from './observabilityStore.js';

// Mirrors types.ts's AI_CALL_PROVIDERS/AI_CALL_OPERATIONS/AI_CALL_STATUSES — duplicated
// rather than imported, same as SCRAPED_JOB_STATUSES/SCRAPED_JOB_FITS in
// routes.scraper.js: this server runs as plain Node (`node --watch server.js`, no TS
// loader), so it can't import from a .ts file.
const AI_CALL_PROVIDERS = ['gemini', 'claude', 'claude_cli', 'fake'];
const AI_CALL_OPERATIONS = ['parse_cv', 'analyze_ats', 'extract_job', 'expand_keywords', 'qualify', 'search_all'];
const AI_CALL_STATUSES = ['success', 'error'];

function errorBody(code, message) {
    return { error: { code, message } };
}

const isValidProvider = (v) => AI_CALL_PROVIDERS.includes(v);
const isValidOperation = (v) => AI_CALL_OPERATIONS.includes(v);
const isValidStatus = (v) => AI_CALL_STATUSES.includes(v);

export function createObservabilityRouter({ observabilityDb }) {
    const router = express.Router();

    // Posted by services/observabilityService.ts after every client-side Gemini/Claude
    // SDK call (services/aiService.ts) finishes, success or error. The server-side
    // claude CLI path (server/scrapers/claudeCli.js) writes directly to observabilityDb
    // instead — it already runs in this process, so there's no need for it to round-trip
    // through its own HTTP call.
    router.post('/calls', (req, res) => {
        const body = req.body ?? {};
        if (!isValidProvider(body.provider)) {
            return res.status(400).json(errorBody('invalid_provider', `provider must be one of: ${AI_CALL_PROVIDERS.join(', ')}`));
        }
        if (!isValidOperation(body.operation)) {
            return res.status(400).json(errorBody('invalid_operation', `operation must be one of: ${AI_CALL_OPERATIONS.join(', ')}`));
        }
        if (!isValidStatus(body.status)) {
            return res.status(400).json(errorBody('invalid_status', `status must be one of: ${AI_CALL_STATUSES.join(', ')}`));
        }
        if (typeof body.durationMs !== 'number' || body.durationMs < 0) {
            return res.status(400).json(errorBody('invalid_duration', 'durationMs must be a non-negative number'));
        }

        const call = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            provider: body.provider,
            operation: body.operation,
            model: typeof body.model === 'string' ? body.model : undefined,
            durationMs: Math.round(body.durationMs),
            status: body.status,
            errorMessage: typeof body.errorMessage === 'string' ? body.errorMessage : undefined,
            promptTokens: typeof body.promptTokens === 'number' ? body.promptTokens : undefined,
            completionTokens: typeof body.completionTokens === 'number' ? body.completionTokens : undefined,
            totalTokens: typeof body.totalTokens === 'number' ? body.totalTokens : undefined,
            finishReason: typeof body.finishReason === 'string' ? body.finishReason : undefined,
            metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
            // Full prompt/response/error text + step trace — no length validation here,
            // truncation is centralized in observabilityStore.js's insertCall so every
            // caller (this route and claudeCli.js's direct insertCall) gets it for free.
            prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
            responseText: typeof body.responseText === 'string' ? body.responseText : undefined,
            errorDetail: typeof body.errorDetail === 'string' ? body.errorDetail : undefined,
            stepTrace: Array.isArray(body.stepTrace) ? body.stepTrace : undefined,
        };

        try {
            insertCall(observabilityDb, call);
            res.json(call);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Polling endpoint: `sinceRowId` lets the client ask "anything new since the last
    // row I saw" (see observabilityStore.listCalls) instead of re-fetching everything
    // every ~5s.
    router.get('/calls', (req, res) => {
        try {
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const sinceRowId = req.query.sinceRowId ? Number(req.query.sinceRowId) : undefined;
            const provider = isValidProvider(req.query.provider) ? req.query.provider : undefined;
            const status = isValidStatus(req.query.status) ? req.query.status : undefined;
            const operation = isValidOperation(req.query.operation) ? req.query.operation : undefined;
            res.json(listCalls(observabilityDb, { limit, sinceRowId, provider, status, operation }));
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    // Full detail for one call — fetched lazily by the Observability page only when a
    // user opens a row (see observabilityStore.js's LIST_COLUMNS/getCallDetail split);
    // includes prompt/responseText/errorDetail/stepTrace, never returned by GET /calls.
    router.get('/calls/:id', (req, res) => {
        try {
            const call = getCallDetail(observabilityDb, req.params.id);
            if (!call) return res.status(404).json(errorBody('not_found', 'No AI call with that id'));
            res.json(call);
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    router.get('/stats', (req, res) => {
        try {
            const rangeStart = typeof req.query.rangeStart === 'string' ? req.query.rangeStart : undefined;
            res.json(getStats(observabilityDb, { rangeStart }));
        } catch (err) {
            res.status(500).json(errorBody('internal_error', err.message));
        }
    });

    return router;
}
