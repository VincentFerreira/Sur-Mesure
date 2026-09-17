import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openObservabilityDb, insertCall, listCalls, getStats, getCallDetail } from '../../server/observabilityStore.js';

let tempDir: string;
let db: ReturnType<typeof openObservabilityDb>;

function makeDb() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-observability-db-test-'));
    db = openObservabilityDb(path.join(tempDir, 'observability.sqlite'));
    return db;
}

afterEach(() => {
    if (db) db.close();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function call(overrides: Record<string, unknown> = {}) {
    return {
        id: 'call-1',
        createdAt: new Date().toISOString(),
        provider: 'gemini',
        operation: 'analyze_ats',
        model: 'gemini-3.1-flash-lite',
        durationMs: 1200,
        status: 'success',
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        ...overrides,
    };
}

describe('insertCall / listCalls', () => {
    it('inserts a call and lists it back, most recent first', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a' }));
        insertCall(db, call({ id: 'b' }));
        const rows = listCalls(db);
        expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('round-trips optional fields as undefined when absent', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', model: undefined, errorMessage: undefined, finishReason: undefined, costUsd: undefined, metadata: undefined }));
        const [row] = listCalls(db);
        expect(row.model).toBeUndefined();
        expect(row.errorMessage).toBeUndefined();
        expect(row.costUsd).toBeUndefined();
    });

    it('round-trips metadata as a JSON object', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', metadata: { batchSize: 25 } }));
        const [row] = listCalls(db);
        expect(row.metadata).toEqual({ batchSize: 25 });
    });

    it('filters by provider', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', provider: 'gemini' }));
        insertCall(db, call({ id: 'b', provider: 'claude' }));
        const rows = listCalls(db, { provider: 'claude' });
        expect(rows.map((r) => r.id)).toEqual(['b']);
    });

    it('filters by status', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', status: 'success' }));
        insertCall(db, call({ id: 'b', status: 'error', errorMessage: 'boom' }));
        const rows = listCalls(db, { status: 'error' });
        expect(rows.map((r) => r.id)).toEqual(['b']);
        expect(rows[0].errorMessage).toBe('boom');
    });

    it('filters by operation', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', operation: 'analyze_ats' }));
        insertCall(db, call({ id: 'b', operation: 'qualify' }));
        const rows = listCalls(db, { operation: 'qualify' });
        expect(rows.map((r) => r.id)).toEqual(['b']);
    });

    it('supports cursor-based polling via sinceRowId', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a' }));
        const afterFirst = listCalls(db)[0].rowId;
        insertCall(db, call({ id: 'b' }));
        insertCall(db, call({ id: 'c' }));
        const rows = listCalls(db, { sinceRowId: afterFirst });
        expect(rows.map((r) => r.id).sort()).toEqual(['b', 'c']);
    });

    it('respects limit', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a' }));
        insertCall(db, call({ id: 'b' }));
        insertCall(db, call({ id: 'c' }));
        expect(listCalls(db, { limit: 2 })).toHaveLength(2);
    });

    // Log rows are pruned on insert, not on a timer — this is a many-small-rows usage
    // log with no retention need, not a durable record (see server/observabilityStore.js).
    it('prunes rows older than 30 days on insert', () => {
        vi.useFakeTimers();
        try {
            const db = makeDb();
            const old = new Date('2020-01-01T00:00:00.000Z');
            vi.setSystemTime(old);
            insertCall(db, call({ id: 'old', createdAt: old.toISOString() }));

            vi.setSystemTime(new Date('2020-03-01T00:00:00.000Z'));
            insertCall(db, call({ id: 'new', createdAt: new Date().toISOString() }));

            const rows = listCalls(db);
            expect(rows.map((r) => r.id)).toEqual(['new']);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getCallDetail / heavy-field capture (prompt, responseText, errorDetail, stepTrace)', () => {
    it('round-trips all four heavy fields, with stepTrace parsed back into an array', () => {
        const db = makeDb();
        const steps = [{ seq: 1, at: new Date().toISOString(), tool: 'WebSearch', input: { query: 'QA Engineer' }, status: 'done', resultSnippet: '2 results' }];
        insertCall(db, call({ id: 'a', prompt: 'You are an expert...', responseText: '{"overallScore":80}', errorDetail: undefined, stepTrace: steps }));
        const detail = getCallDetail(db, 'a')!;
        expect(detail.prompt).toBe('You are an expert...');
        expect(detail.responseText).toBe('{"overallScore":80}');
        expect(detail.stepTrace).toEqual(steps);
    });

    it('returns undefined for an unknown id', () => {
        const db = makeDb();
        expect(getCallDetail(db, 'nope')).toBeUndefined();
    });

    it('listCalls never returns prompt/responseText/errorDetail/stepTrace even when set on the row', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', prompt: 'secret prompt', responseText: 'secret response', errorDetail: 'secret error', stepTrace: [{ seq: 1, at: '2026-01-01', tool: 'WebSearch', status: 'done' }] }));
        const [row] = listCalls(db);
        // The SQL SELECT (LIST_COLUMNS) never reads these columns off disk at all, so
        // the value is undefined regardless — same as what a JSON.stringify'd HTTP
        // response would actually show the client (undefined-valued keys are dropped).
        expect(row.prompt).toBeUndefined();
        expect(row.responseText).toBeUndefined();
        expect(row.errorDetail).toBeUndefined();
        expect(row.stepTrace).toBeUndefined();
    });

    it('truncates an over-long prompt/responseText/errorDetail, ending with an ellipsis', () => {
        const db = makeDb();
        const huge = 'x'.repeat(300_000);
        insertCall(db, call({ id: 'a', prompt: huge, responseText: huge, errorDetail: undefined, status: 'success' }));
        const detail = getCallDetail(db, 'a')!;
        expect(detail.prompt.length).toBeLessThan(300_000);
        expect(detail.prompt.endsWith('…')).toBe(true);
        expect(detail.responseText.length).toBeLessThan(300_000);
    });

    it('structurally bounds an over-long stepTrace with an omitted-count sentinel, and truncates a long resultSnippet', () => {
        const db = makeDb();
        const steps = Array.from({ length: 250 }, (_, i) => ({ seq: i + 1, at: '2026-01-01', tool: 'WebSearch', status: 'done', resultSnippet: i === 0 ? 'y'.repeat(5_000) : 'ok' }));
        insertCall(db, call({ id: 'a', stepTrace: steps }));
        const detail = getCallDetail(db, 'a')!;
        expect(detail.stepTrace).toHaveLength(201); // 200 kept + 1 sentinel
        expect(detail.stepTrace[200]).toMatchObject({ note: expect.stringContaining('50 more steps omitted') });
        expect(detail.stepTrace[0].resultSnippet.length).toBeLessThan(5_000);
        expect(detail.stepTrace[0].resultSnippet.endsWith('…')).toBe(true);
    });

    // First-ever test of this file's additive-migration path (PRAGMA table_info ->
    // ALTER TABLE ADD COLUMN) — this repo's real data/observability.sqlite predates
    // the heavy columns, so opening it must add them without losing existing rows.
    it('adds the heavy columns to a pre-existing database that predates them', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-observability-migration-test-'));
        const dbPath = path.join(tempDir, 'observability.sqlite');
        const raw = new DatabaseSync(dbPath);
        raw.exec(`CREATE TABLE ai_calls (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL,
            model TEXT, duration_ms INTEGER NOT NULL, status TEXT NOT NULL, error_message TEXT,
            prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, finish_reason TEXT,
            cost_usd REAL, metadata TEXT
        )`);
        raw.prepare(
            `INSERT INTO ai_calls (id, created_at, provider, operation, duration_ms, status) VALUES (?, ?, ?, ?, ?, ?)`
        ).run('legacy-1', new Date().toISOString(), 'gemini', 'analyze_ats', 1000, 'success');
        raw.close();

        db = openObservabilityDb(dbPath);
        const legacy = getCallDetail(db, 'legacy-1')!;
        expect(legacy.prompt).toBeUndefined();
        expect(legacy.stepTrace).toBeUndefined();

        insertCall(db, call({ id: 'new-1', prompt: 'hello' }));
        expect(getCallDetail(db, 'new-1')!.prompt).toBe('hello');
    });
});

describe('getStats', () => {
    it('returns zeroed stats for an empty database', () => {
        const db = makeDb();
        expect(getStats(db)).toEqual({
            totalCalls: 0,
            totalTokens: 0,
            totalCostUsd: 0,
            avgDurationMs: 0,
            errorRate: 0,
            byProvider: {},
            byOperation: {},
        });
    });

    it('aggregates totals, cost, error rate, and per-provider/operation breakdowns', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', provider: 'gemini', operation: 'analyze_ats', totalTokens: 700, durationMs: 1000, status: 'success', costUsd: 0.01 }));
        insertCall(db, call({ id: 'b', provider: 'claude', operation: 'parse_cv', totalTokens: 300, durationMs: 2000, status: 'success', costUsd: 0.02 }));
        insertCall(db, call({ id: 'c', provider: 'gemini', operation: 'analyze_ats', totalTokens: 0, durationMs: 500, status: 'error', errorMessage: 'timeout', costUsd: undefined }));

        const stats = getStats(db);
        expect(stats.totalCalls).toBe(3);
        expect(stats.totalTokens).toBe(1000);
        expect(stats.totalCostUsd).toBeCloseTo(0.03);
        expect(stats.avgDurationMs).toBe(Math.round((1000 + 2000 + 500) / 3));
        expect(stats.errorRate).toBeCloseTo(1 / 3);
        expect(stats.byProvider.gemini).toEqual({ calls: 2, tokens: 700, costUsd: 0.01, avgDurationMs: 750, errors: 1 });
        expect(stats.byProvider.claude).toEqual({ calls: 1, tokens: 300, costUsd: 0.02, avgDurationMs: 2000, errors: 0 });
        expect(stats.byOperation.analyze_ats).toEqual({ calls: 2, tokens: 700, costUsd: 0.01, avgDurationMs: 750, errors: 1 });
        expect(stats.byOperation.parse_cv).toEqual({ calls: 1, tokens: 300, costUsd: 0.02, avgDurationMs: 2000, errors: 0 });
    });
});
