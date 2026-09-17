import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openObservabilityDb, insertCall, listCalls, getStats } from '../../server/observabilityStore.js';

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

describe('getStats', () => {
    it('returns zeroed stats for an empty database', () => {
        const db = makeDb();
        expect(getStats(db)).toEqual({
            totalCalls: 0,
            totalTokens: 0,
            avgDurationMs: 0,
            errorRate: 0,
            byProvider: {},
            byOperation: {},
        });
    });

    it('aggregates totals, error rate, and per-provider/operation breakdowns', () => {
        const db = makeDb();
        insertCall(db, call({ id: 'a', provider: 'gemini', operation: 'analyze_ats', totalTokens: 700, durationMs: 1000, status: 'success' }));
        insertCall(db, call({ id: 'b', provider: 'claude', operation: 'parse_cv', totalTokens: 300, durationMs: 2000, status: 'success' }));
        insertCall(db, call({ id: 'c', provider: 'gemini', operation: 'analyze_ats', totalTokens: 0, durationMs: 500, status: 'error', errorMessage: 'timeout' }));

        const stats = getStats(db);
        expect(stats.totalCalls).toBe(3);
        expect(stats.totalTokens).toBe(1000);
        expect(stats.avgDurationMs).toBe(Math.round((1000 + 2000 + 500) / 3));
        expect(stats.errorRate).toBeCloseTo(1 / 3);
        expect(stats.byProvider.gemini).toEqual({ calls: 2, tokens: 700, errors: 1 });
        expect(stats.byProvider.claude).toEqual({ calls: 1, tokens: 300, errors: 0 });
        expect(stats.byOperation.analyze_ats).toEqual({ calls: 2, tokens: 700, errors: 1 });
        expect(stats.byOperation.parse_cv).toEqual({ calls: 1, tokens: 300, errors: 0 });
    });
});
