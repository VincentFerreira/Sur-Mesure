import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    openCandidatesDb,
    listCandidates,
    getCandidate,
    insertCandidateIfNew,
    updateCandidate,
    deleteCandidate,
    upsertCandidateRaw,
} from '../../server/scraperCandidatesStore.js';

let tempDir: string;
let db: ReturnType<typeof openCandidatesDb>;

function makeDb() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-candidates-db-test-'));
    db = openCandidatesDb(path.join(tempDir, 'candidates.sqlite'));
    return db;
}

afterEach(() => {
    if (db) db.close();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function candidate(overrides: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    return {
        id: 'id-1',
        dedupeKey: 'dk-1',
        portal: 'france_travail',
        title: 'QA Engineer',
        company: 'Acme',
        url: 'https://example.test/1',
        status: 'new',
        isRemote: false,
        firstSeenAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('insertCandidateIfNew', () => {
    it('inserts a new candidate and returns true', () => {
        const db = makeDb();
        expect(insertCandidateIfNew(db, candidate())).toBe(true);
        expect(getCandidate(db, 'id-1')).toMatchObject({ id: 'id-1', dedupeKey: 'dk-1' });
    });

    it('returns false and does not insert when dedupeKey already exists', () => {
        const db = makeDb();
        insertCandidateIfNew(db, candidate());
        const result = insertCandidateIfNew(db, candidate({ id: 'id-2', dedupeKey: 'dk-1' }));
        expect(result).toBe(false);
        expect(getCandidate(db, 'id-2')).toBeUndefined();
    });
});

describe('listCandidates', () => {
    it('returns all candidates sorted by updatedAt descending when no status filter is given', () => {
        const db = makeDb();
        insertCandidateIfNew(db, candidate({ id: 'a', dedupeKey: 'dk-a', updatedAt: '2026-01-01T00:00:00.000Z' }));
        insertCandidateIfNew(db, candidate({ id: 'b', dedupeKey: 'dk-b', updatedAt: '2026-01-03T00:00:00.000Z' }));
        insertCandidateIfNew(db, candidate({ id: 'c', dedupeKey: 'dk-c', updatedAt: '2026-01-02T00:00:00.000Z' }));
        const all = listCandidates(db);
        expect(all.map((c: { id: string }) => c.id)).toEqual(['b', 'c', 'a']);
    });

    it('filters by status when given', () => {
        const db = makeDb();
        insertCandidateIfNew(db, candidate({ id: 'a', dedupeKey: 'dk-a', status: 'new' }));
        insertCandidateIfNew(db, candidate({ id: 'b', dedupeKey: 'dk-b', status: 'dismissed' }));
        const dismissed = listCandidates(db, ['dismissed']);
        expect(dismissed.map((c: { id: string }) => c.id)).toEqual(['b']);
    });
});

describe('getCandidate', () => {
    it('returns undefined for an unknown id', () => {
        const db = makeDb();
        expect(getCandidate(db, 'nope')).toBeUndefined();
    });
});

describe('updateCandidate', () => {
    it('round-trips every field, including signals (array) and isRemote (boolean)', () => {
        const db = makeDb();
        insertCandidateIfNew(db, candidate());
        const updated = {
            ...candidate(),
            fit: 'high',
            score: 92,
            signals: [{ label: 'Playwright', polarity: 'positive' }],
            isRemote: true,
            department: '92',
            status: 'imported',
            importedJobId: 'job-1',
        };
        expect(updateCandidate(db, updated)).toBe(true);
        const fetched = getCandidate(db, 'id-1');
        expect(fetched?.fit).toBe('high');
        expect(fetched?.score).toBe(92);
        expect(fetched?.signals).toEqual([{ label: 'Playwright', polarity: 'positive' }]);
        expect(fetched?.isRemote).toBe(true);
        expect(fetched?.department).toBe('92');
        expect(fetched?.status).toBe('imported');
        expect(fetched?.importedJobId).toBe('job-1');
    });

    it('returns false when updating an unknown id', () => {
        const db = makeDb();
        expect(updateCandidate(db, candidate({ id: 'nope' }))).toBe(false);
    });
});

describe('deleteCandidate', () => {
    it('deletes an existing candidate and returns true', () => {
        const db = makeDb();
        insertCandidateIfNew(db, candidate());
        expect(deleteCandidate(db, 'id-1')).toBe(true);
        expect(getCandidate(db, 'id-1')).toBeUndefined();
    });

    it('returns false for an unknown id', () => {
        const db = makeDb();
        expect(deleteCandidate(db, 'nope')).toBe(false);
    });
});

describe('upsertCandidateRaw', () => {
    it('inserts a candidate regardless of dedupe semantics', () => {
        const db = makeDb();
        upsertCandidateRaw(db, candidate());
        expect(getCandidate(db, 'id-1')).toMatchObject({ id: 'id-1' });
    });

    it('overwrites an existing id in place without touching dedupe_key uniqueness', () => {
        const db = makeDb();
        upsertCandidateRaw(db, candidate({ title: 'Original' }));
        upsertCandidateRaw(db, candidate({ title: 'Updated' }));
        const fetched = getCandidate(db, 'id-1');
        expect(fetched?.title).toBe('Updated');
        expect(listCandidates(db)).toHaveLength(1);
    });
});
