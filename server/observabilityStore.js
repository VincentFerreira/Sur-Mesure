import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// SQLite-backed log of every AI call the app makes (client-side Gemini/Claude SDK
// calls via services/aiService.ts, and server-side `claude` CLI invocations via
// server/scrapers/claudeCli.js) — powers the Observability page. Same node:sqlite
// DatabaseSync pattern as server/scraperCandidatesStore.js (zero new npm dependency,
// zero native compile step), chosen for the same reason: this is a many-small-rows
// log with no retention need, unlike cvs/jobs/companies which stay as JSON.

// `prompt`/`response_text`/`error_detail`/`step_trace` are the "heavy" columns — full
// prompt/response text and (for search_all) a step-by-step tool-call trace. Kept out
// of LIST_COLUMNS (see listCalls) so the 5s-polled list never reads them off disk;
// only getCallDetail (one row, fetched on demand when a user opens a call) selects
// them via CALL_COLUMNS.
const HEAVY_COLUMNS = ['prompt', 'response_text', 'error_detail', 'step_trace'];

const CALL_COLUMNS = [
    'id',
    'created_at',
    'provider',
    'operation',
    'model',
    'duration_ms',
    'status',
    'error_message',
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'finish_reason',
    'cost_usd',
    'metadata',
    ...HEAVY_COLUMNS,
];

const LIST_COLUMNS = CALL_COLUMNS.filter((c) => !HEAVY_COLUMNS.includes(c));

// Rows older than this are pruned on every insert — this is a live-usage log, not a
// durable record, so unbounded growth (a call is logged on every single AI request)
// isn't worth guarding against with anything fancier than a delete-on-write.
const RETENTION_DAYS = 30;

// Plain string truncation for prompt/response/error text — same shape as the
// truncate() helper in server/scrapers/claudeCli.js, duplicated rather than imported
// so this file stays dependency-free of server/scrapers/*.
function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const MAX_TEXT_LENGTH = 200_000; // prompt / response_text — a real CV+JD ATS prompt is a few KB; this only bites a genuinely runaway response.
const MAX_ERROR_DETAIL_LENGTH = 50_000; // raw stdout/stderr/JSON envelope.
const MAX_STEP_TRACE_STEPS = 200; // structural cap on the step_trace ARRAY, not a string length — see boundStepTrace.
const MAX_STEP_SNIPPET_LENGTH = 2_000; // per-step resultSnippet — a raw WebFetch page can be huge; 2KB is enough to diagnose a failure.

// Structural bounding applied BEFORE JSON.stringify — tail-slicing the serialized
// JSON string (like truncate() does for plain text) would produce invalid JSON, so
// step_trace instead caps the array length (with an "omitted" sentinel) and each
// step's resultSnippet individually.
function boundStepTrace(steps) {
    const bounded = steps.length > MAX_STEP_TRACE_STEPS ? steps.slice(0, MAX_STEP_TRACE_STEPS) : steps;
    const withTruncatedSnippets = bounded.map((step) =>
        step.resultSnippet && step.resultSnippet.length > MAX_STEP_SNIPPET_LENGTH
            ? { ...step, resultSnippet: truncate(step.resultSnippet, MAX_STEP_SNIPPET_LENGTH) }
            : step
    );
    return steps.length > MAX_STEP_TRACE_STEPS
        ? [...withTruncatedSnippets, { note: `… ${steps.length - MAX_STEP_TRACE_STEPS} more steps omitted` }]
        : withTruncatedSnippets;
}

function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_calls (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        model TEXT,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        finish_reason TEXT,
        cost_usd REAL,
        metadata TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_ai_calls_created_at ON ai_calls(created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ai_calls_provider ON ai_calls(provider)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ai_calls_status ON ai_calls(status)');

    // Additive migration for a database created before full prompt/response capture
    // existed (this repo's `data/observability.sqlite` already has real rows) — same
    // PRAGMA table_info -> ALTER TABLE ADD COLUMN pattern as
    // server/scraperCandidatesStore.js. No backfill: there is no way to recover the
    // original prompt/response text for already-logged rows, so they simply read back
    // as null/undefined for these fields — an expected, one-time consequence, not a bug.
    const existingColumns = new Set(db.prepare('PRAGMA table_info(ai_calls)').all().map((c) => c.name));
    for (const column of HEAVY_COLUMNS) {
        if (!existingColumns.has(column)) db.exec(`ALTER TABLE ai_calls ADD COLUMN ${column} TEXT`);
    }
}

export function openObservabilityDb(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    ensureSchema(db);
    return db;
}

function callToRow(call) {
    return {
        id: call.id,
        created_at: call.createdAt,
        provider: call.provider,
        operation: call.operation,
        model: call.model ?? null,
        duration_ms: call.durationMs,
        status: call.status,
        error_message: call.errorMessage ?? null,
        prompt_tokens: call.promptTokens ?? null,
        completion_tokens: call.completionTokens ?? null,
        total_tokens: call.totalTokens ?? null,
        finish_reason: call.finishReason ?? null,
        cost_usd: call.costUsd ?? null,
        metadata: call.metadata ? JSON.stringify(call.metadata) : null,
        // Truncated here — the single funnel every write path goes through (the client
        // HTTP path via routes.observability.js's insertCall call, and claudeCli.js's
        // direct insertCall call) — so no caller needs to duplicate size limits.
        prompt: call.prompt ? truncate(call.prompt, MAX_TEXT_LENGTH) : null,
        response_text: call.responseText ? truncate(call.responseText, MAX_TEXT_LENGTH) : null,
        error_detail: call.errorDetail ? truncate(call.errorDetail, MAX_ERROR_DETAIL_LENGTH) : null,
        step_trace: call.stepTrace && call.stepTrace.length > 0 ? JSON.stringify(boundStepTrace(call.stepTrace)) : null,
    };
}

function rowToCall(row) {
    if (!row) return undefined;
    return {
        id: row.id,
        createdAt: row.created_at,
        provider: row.provider,
        operation: row.operation,
        model: row.model ?? undefined,
        durationMs: row.duration_ms,
        status: row.status,
        errorMessage: row.error_message ?? undefined,
        promptTokens: row.prompt_tokens ?? undefined,
        completionTokens: row.completion_tokens ?? undefined,
        totalTokens: row.total_tokens ?? undefined,
        finishReason: row.finish_reason ?? undefined,
        costUsd: row.cost_usd ?? undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        prompt: row.prompt ?? undefined,
        responseText: row.response_text ?? undefined,
        errorDetail: row.error_detail ?? undefined,
        stepTrace: row.step_trace ? JSON.parse(row.step_trace) : undefined,
    };
}

// Insert is the only write this log ever does (no updates — a call, once logged, is
// immutable) — pruning happens here rather than on a timer/cron, since this is the
// only place the table's size ever grows and this app has no background scheduler.
export function insertCall(db, call) {
    const row = callToRow(call);
    const sql = `INSERT INTO ai_calls (${CALL_COLUMNS.join(', ')}) VALUES (${CALL_COLUMNS.map(() => '?').join(', ')})`;
    db.prepare(sql).run(...CALL_COLUMNS.map((c) => row[c]));

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM ai_calls WHERE created_at < ?').run(cutoff);
}

// Cursor-based ("give me everything after this id") rather than time-based, so a
// polling client can cheaply ask "anything new since the last row I saw" without
// re-fetching rows it already has, and without worrying about two rows sharing a
// timestamp. `id` is a UUID (insertion order isn't lexicographic), so pagination
// keys off `rowid` instead, which SQLite maintains as a monotonically increasing
// insertion-order integer for a table with no other INTEGER PRIMARY KEY.
//
// JSDoc-typed (unlike the rest of this file) because TS's checkJs inference for a
// plain destructured options object drops optional properties that are only ever
// read inside an `if`, never otherwise narrowed — importing .test.ts files then see
// an incomplete inferred type (missing sinceRowId/provider/status) without this.
/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ limit?: number, sinceRowId?: number, provider?: string, status?: string, operation?: string }} [options]
 */
export function listCalls(db, { limit = 100, sinceRowId, provider, status, operation } = {}) {
    const conditions = [];
    const params = [];
    if (sinceRowId !== undefined) {
        conditions.push('rowid > ?');
        params.push(sinceRowId);
    }
    if (provider) {
        conditions.push('provider = ?');
        params.push(provider);
    }
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    if (operation) {
        conditions.push('operation = ?');
        params.push(operation);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Explicit column list (LIST_COLUMNS), not `*` — the 5s-polled list must never even
    // read prompt/response_text/error_detail/step_trace off disk, not just drop them in
    // JS afterwards. Full detail is only ever read by getCallDetail below.
    const sql = `SELECT rowid AS row_id, ${LIST_COLUMNS.join(', ')} FROM ai_calls ${where} ORDER BY rowid DESC LIMIT ?`;
    params.push(limit);
    return db
        .prepare(sql)
        .all(...params)
        .map((row) => ({ ...rowToCall(row), rowId: Number(row.row_id) }));
}

// Full row by primary key — used only by the Observability page's per-call detail
// view, fetched lazily on click (never polled), so reading every column here is fine.
export function getCallDetail(db, id) {
    const sql = `SELECT ${CALL_COLUMNS.join(', ')} FROM ai_calls WHERE id = ?`;
    return rowToCall(db.prepare(sql).get(id));
}

// `column` is always one of the hardcoded literals below ('provider'/'operation'),
// never request input — safe to interpolate directly into the SQL text.
function statsByGroup(db, where, params, column) {
    return db
        .prepare(
            `SELECT ${column} AS key, COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens,
             COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(AVG(duration_ms), 0) AS avg_duration,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
             FROM ai_calls ${where} GROUP BY ${column}`
        )
        .all(...params)
        .reduce((acc, row) => {
            acc[row.key] = { calls: row.calls, tokens: row.tokens, costUsd: row.cost, avgDurationMs: Math.round(row.avg_duration), errors: row.errors };
            return acc;
        }, {});
}

export function getStats(db, { rangeStart } = {}) {
    const where = rangeStart ? 'WHERE created_at >= ?' : '';
    const params = rangeStart ? [rangeStart] : [];

    const totals = db
        .prepare(
            `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost,
             COALESCE(AVG(duration_ms), 0) AS avg_duration,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
             FROM ai_calls ${where}`
        )
        .get(...params);

    const totalCalls = totals?.calls ?? 0;
    return {
        totalCalls,
        totalTokens: totals?.tokens ?? 0,
        totalCostUsd: totals?.cost ?? 0,
        avgDurationMs: totalCalls > 0 ? Math.round(totals.avg_duration) : 0,
        errorRate: totalCalls > 0 ? (totals.errors ?? 0) / totalCalls : 0,
        byProvider: statsByGroup(db, where, params, 'provider'),
        byOperation: statsByGroup(db, where, params, 'operation'),
    };
}
