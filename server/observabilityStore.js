import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// SQLite-backed log of every AI call the app makes (client-side Gemini/Claude SDK
// calls via services/aiService.ts, and server-side `claude` CLI invocations via
// server/scrapers/claudeCli.js) — powers the Observability page. Same node:sqlite
// DatabaseSync pattern as server/scraperCandidatesStore.js (zero new npm dependency,
// zero native compile step), chosen for the same reason: this is a many-small-rows
// log with no retention need, unlike cvs/jobs/companies which stay as JSON.

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
];

// Rows older than this are pruned on every insert — this is a live-usage log, not a
// durable record, so unbounded growth (a call is logged on every single AI request)
// isn't worth guarding against with anything fancier than a delete-on-write.
const RETENTION_DAYS = 30;

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
 * @param {{ limit?: number, sinceRowId?: number, provider?: string, status?: string }} [options]
 */
export function listCalls(db, { limit = 100, sinceRowId, provider, status } = {}) {
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
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT rowid AS row_id, * FROM ai_calls ${where} ORDER BY rowid DESC LIMIT ?`;
    params.push(limit);
    return db
        .prepare(sql)
        .all(...params)
        .map((row) => ({ ...rowToCall(row), rowId: Number(row.row_id) }));
}

export function getStats(db, { rangeStart } = {}) {
    const where = rangeStart ? 'WHERE created_at >= ?' : '';
    const params = rangeStart ? [rangeStart] : [];

    const totals = db
        .prepare(
            `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(AVG(duration_ms), 0) AS avg_duration,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
             FROM ai_calls ${where}`
        )
        .get(...params);

    const byGroup = (column) =>
        db
            .prepare(
                `SELECT ${column} AS key, COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS tokens,
                 SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
                 FROM ai_calls ${where} GROUP BY ${column}`
            )
            .all(...params)
            .reduce((acc, row) => {
                acc[row.key] = { calls: row.calls, tokens: row.tokens, errors: row.errors };
                return acc;
            }, {});

    const totalCalls = totals?.calls ?? 0;
    return {
        totalCalls,
        totalTokens: totals?.tokens ?? 0,
        avgDurationMs: totalCalls > 0 ? Math.round(totals.avg_duration) : 0,
        errorRate: totalCalls > 0 ? (totals.errors ?? 0) / totalCalls : 0,
        byProvider: byGroup('provider'),
        byOperation: byGroup('operation'),
    };
}
