import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    openCandidatesDb,
    listCandidates,
    getCandidate,
    upsertSeenCandidate,
    markCandidatesViewed,
    updateCandidate,
    deleteCandidate,
    upsertCandidateRaw,
    listRejectionReasons,
} from '../../server/scraperCandidatesStore.js';
import { makeFingerprint } from '../../server/scraperFingerprint.js';

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
        fingerprint: 'fp-1',
        portal: 'france_travail',
        title: 'QA Engineer',
        company: 'Acme',
        url: 'https://example.test/1',
        status: 'new',
        isRemote: false,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('upsertSeenCandidate', () => {
    it('inserts a brand-new candidate when the fingerprint is unseen', () => {
        const db = makeDb();
        expect(upsertSeenCandidate(db, candidate())).toEqual({ isNew: true });
        expect(getCandidate(db, 'id-1')).toMatchObject({ id: 'id-1', fingerprint: 'fp-1' });
    });

    it('touches ONLY last_seen_at when the fingerprint already exists, preserving status/fit/score/viewedAt', () => {
        const db = makeDb();
        upsertSeenCandidate(
            db,
            candidate({
                fit: 'high',
                score: 90,
                signals: [{ label: 'Playwright', polarity: 'positive' }],
            })
        );
        // Simulate a human having triaged this candidate before it resurfaces: dismissed
        // and viewed. Per the spec, a re-scrape must never undo either of these.
        const dismissedAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
        markCandidatesViewed(db, ['id-1']);
        updateCandidate(db, { ...getCandidate(db, 'id-1'), status: 'dismissed' });

        const laterSeen = new Date('2026-06-01T00:00:00.000Z').toISOString();
        const result = upsertSeenCandidate(db, candidate({ lastSeenAt: laterSeen, status: 'new' }));

        expect(result).toEqual({ isNew: false });
        const fetched = getCandidate(db, 'id-1');
        expect(fetched?.lastSeenAt).toBe(laterSeen);
        expect(fetched?.status).toBe('dismissed'); // NOT reset to 'new'
        expect(fetched?.viewedAt).toBeTruthy(); // NOT cleared
        expect(fetched?.fit).toBe('high'); // untouched
        expect(fetched?.score).toBe(90); // untouched
        expect(dismissedAt).toBeTruthy(); // silence unused-var lint in case of refactor
    });

    it('does not insert a second row for a duplicate fingerprint appearing twice in the same batch', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate());
        upsertSeenCandidate(db, candidate({ id: 'id-2' }));
        expect(listCandidates(db)).toHaveLength(1);
    });

    it('two different fingerprints both insert as new', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate());
        upsertSeenCandidate(db, candidate({ id: 'id-2', fingerprint: 'fp-2', dedupeKey: 'dk-2' }));
        expect(listCandidates(db)).toHaveLength(2);
    });

    // Regression test for a real production crash: "UNIQUE constraint failed:
    // candidates.dedupe_key". dedupe_key (company+title slug only) is coarser than
    // fingerprint (which also factors in department, or a portal external id) — the
    // same company+title posted in two different départements shares a dedupe_key
    // while having two distinct fingerprints. Both are genuinely new postings and must
    // both insert; a legacy UNIQUE constraint on dedupe_key used to make the second
    // INSERT throw and abort the whole /run request.
    it('inserts two candidates that share a dedupe_key but have different fingerprints', () => {
        const db = makeDb();
        expect(() => {
            upsertSeenCandidate(db, candidate({ id: 'id-1', fingerprint: 'fp-paris', dedupeKey: 'acme_qa-engineer', department: '75' }));
            upsertSeenCandidate(db, candidate({ id: 'id-2', fingerprint: 'fp-lyon', dedupeKey: 'acme_qa-engineer', department: '69' }));
        }).not.toThrow();
        expect(listCandidates(db)).toHaveLength(2);
    });
});

describe('markCandidatesViewed', () => {
    it('marks the given unviewed candidates and returns the count actually changed', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate());
        upsertSeenCandidate(db, candidate({ id: 'id-2', fingerprint: 'fp-2', dedupeKey: 'dk-2' }));
        const count = markCandidatesViewed(db, ['id-1', 'id-2']);
        expect(count).toBe(2);
        expect(getCandidate(db, 'id-1')?.viewedAt).toBeTruthy();
        expect(getCandidate(db, 'id-2')?.viewedAt).toBeTruthy();
    });

    it('does not re-stamp an already-viewed candidate', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate());
        markCandidatesViewed(db, ['id-1']);
        const firstViewedAt = getCandidate(db, 'id-1')?.viewedAt;
        const second = markCandidatesViewed(db, ['id-1']);
        expect(second).toBe(0);
        expect(getCandidate(db, 'id-1')?.viewedAt).toBe(firstViewedAt);
    });

    it('returns 0 and touches nothing for an empty id list', () => {
        const db = makeDb();
        expect(markCandidatesViewed(db, [])).toBe(0);
    });
});

describe('listCandidates', () => {
    it('returns all candidates sorted by updatedAt descending when no status filter is given', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate({ id: 'a', fingerprint: 'fp-a', dedupeKey: 'dk-a', updatedAt: '2026-01-01T00:00:00.000Z' }));
        upsertSeenCandidate(db, candidate({ id: 'b', fingerprint: 'fp-b', dedupeKey: 'dk-b', updatedAt: '2026-01-03T00:00:00.000Z' }));
        upsertSeenCandidate(db, candidate({ id: 'c', fingerprint: 'fp-c', dedupeKey: 'dk-c', updatedAt: '2026-01-02T00:00:00.000Z' }));
        const all = listCandidates(db);
        expect(all.map((c: { id: string }) => c.id)).toEqual(['b', 'c', 'a']);
    });

    it('filters by status when given', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate({ id: 'a', fingerprint: 'fp-a', dedupeKey: 'dk-a', status: 'new' }));
        upsertSeenCandidate(db, candidate({ id: 'b', fingerprint: 'fp-b', dedupeKey: 'dk-b', status: 'dismissed' }));
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
        upsertSeenCandidate(db, candidate());
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
        upsertSeenCandidate(db, candidate());
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

    it('accepts a candidate with no fingerprint at all (legacy/test fixtures predating this field)', () => {
        const db = makeDb();
        const { fingerprint, ...withoutFingerprint } = candidate();
        expect(() => upsertCandidateRaw(db, withoutFingerprint)).not.toThrow();
        expect(getCandidate(db, 'id-1')?.fingerprint).toBeUndefined();
        expect(fingerprint).toBeTruthy(); // sanity: confirms destructuring actually removed a real value
    });
});

describe('schema migration on a pre-existing database', () => {
    it('adds the new columns and backfills fingerprint via the real formula (not a dedupe_key copy)', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-candidates-db-test-'));
        const dbPath = path.join(tempDir, 'candidates.sqlite');

        // Build a database with the OLD (pre-feature) schema by hand — the exact shape
        // scraperCandidatesStore.js used before fingerprint/external_id/last_seen_at/
        // viewed_at existed — then seed one legacy row into it.
        const oldDb = new DatabaseSync(dbPath);
        oldDb.exec(`CREATE TABLE candidates (
            id TEXT PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            portal TEXT NOT NULL,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT,
            department TEXT,
            is_remote INTEGER NOT NULL DEFAULT 0,
            contract_type TEXT,
            salary_range TEXT,
            url TEXT NOT NULL,
            posted_date TEXT,
            description_raw TEXT,
            fit TEXT,
            score INTEGER,
            signals TEXT,
            status TEXT NOT NULL,
            imported_job_id TEXT,
            first_seen_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`);
        oldDb.prepare(
            `INSERT INTO candidates (id, dedupe_key, portal, title, company, url, status, first_seen_at, updated_at, department)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            'legacy-1',
            'acme_qa-engineer',
            'france_travail',
            'QA Engineer',
            'Acme',
            'https://example.test/legacy',
            'new',
            '2026-01-01T00:00:00.000Z',
            '2026-01-02T00:00:00.000Z',
            '75'
        );
        oldDb.close();

        // Opening this pre-existing (old-schema) file through the real code path must
        // add the 4 columns and backfill them.
        db = openCandidatesDb(dbPath);
        const migrated = getCandidate(db, 'legacy-1');
        expect(migrated?.fingerprint).toBe(makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: '75' }));
        expect(migrated?.fingerprint).not.toBe('acme_qa-engineer'); // NOT a verbatim dedupe_key copy
        expect(migrated?.lastSeenAt).toBe('2026-01-02T00:00:00.000Z'); // backfilled from updated_at
        expect(migrated?.viewedAt).toBeUndefined(); // never backfilled — honestly "never viewed"
    });

    it('rebuilds the table to drop the legacy UNIQUE constraint on dedupe_key', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-candidates-db-test-'));
        const dbPath = path.join(tempDir, 'candidates.sqlite');

        const oldDb = new DatabaseSync(dbPath);
        oldDb.exec(`CREATE TABLE candidates (
            id TEXT PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            portal TEXT NOT NULL,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT,
            department TEXT,
            is_remote INTEGER NOT NULL DEFAULT 0,
            contract_type TEXT,
            salary_range TEXT,
            url TEXT NOT NULL,
            posted_date TEXT,
            description_raw TEXT,
            fit TEXT,
            score INTEGER,
            signals TEXT,
            status TEXT NOT NULL,
            imported_job_id TEXT,
            first_seen_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`);
        oldDb.prepare(
            `INSERT INTO candidates (id, dedupe_key, portal, title, company, url, status, first_seen_at, updated_at, department)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run('legacy-1', 'acme_qa-engineer', 'france_travail', 'QA Engineer', 'Acme', 'https://example.test/legacy', 'new', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '75');
        oldDb.close();

        db = openCandidatesDb(dbPath);
        const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='candidates'").get() as { sql: string };
        expect(tableSql.sql).not.toMatch(/UNIQUE/i);

        // The row that predates the rebuild must survive it untouched...
        expect(getCandidate(db, 'legacy-1')).toMatchObject({ id: 'legacy-1', company: 'Acme', title: 'QA Engineer' });
        // ...and a genuinely new candidate sharing the same dedupe_key (different
        // fingerprint) must now insert without throwing.
        expect(() => {
            upsertSeenCandidate(db, candidate({ id: 'legacy-2', fingerprint: 'fp-lyon', dedupeKey: 'acme_qa-engineer', department: '69' }));
        }).not.toThrow();
        expect(listCandidates(db)).toHaveLength(2);
    });

    it('is a no-op backfill-wise on a second open (columns already present)', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-candidates-db-test-'));
        const dbPath = path.join(tempDir, 'candidates.sqlite');
        db = openCandidatesDb(dbPath);
        upsertSeenCandidate(db, candidate());
        markCandidatesViewed(db, ['id-1']);
        const before = getCandidate(db, 'id-1');
        db.close();

        db = openCandidatesDb(dbPath); // re-open — must not touch already-populated rows
        const after = getCandidate(db, 'id-1');
        expect(after).toEqual(before);
    });
});

describe('listRejectionReasons', () => {
    it('returns only dismissed candidates that have a non-empty reason, most-recent-first', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate({ id: 'no-reason', fingerprint: 'fp-a', status: 'dismissed' }));
        upsertSeenCandidate(db, candidate({ id: 'still-new', fingerprint: 'fp-b' }));
        updateCandidate(db, { ...getCandidate(db, 'no-reason'), dismissReason: '' });

        upsertSeenCandidate(db, candidate({ id: 'reason-1', fingerprint: 'fp-c', status: 'dismissed', company: 'Old Co', title: 'Old role' }));
        updateCandidate(db, {
            ...getCandidate(db, 'reason-1'),
            dismissReason: 'ESN / régie',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });

        upsertSeenCandidate(db, candidate({ id: 'reason-2', fingerprint: 'fp-d', status: 'dismissed', company: 'New Co', title: 'New role' }));
        updateCandidate(db, {
            ...getCandidate(db, 'reason-2'),
            dismissReason: 'Salaire trop bas',
            updatedAt: '2026-02-01T00:00:00.000Z',
        });

        expect(listRejectionReasons(db)).toEqual([
            { title: 'New role', company: 'New Co', reason: 'Salaire trop bas' },
            { title: 'Old role', company: 'Old Co', reason: 'ESN / régie' },
        ]);
    });

    it('respects the limit', () => {
        const db = makeDb();
        for (let i = 0; i < 5; i++) {
            upsertSeenCandidate(db, candidate({ id: `c${i}`, fingerprint: `fp-${i}`, status: 'dismissed' }));
            updateCandidate(db, { ...getCandidate(db, `c${i}`), dismissReason: `reason ${i}`, updatedAt: `2026-01-0${i + 1}T00:00:00.000Z` });
        }
        expect(listRejectionReasons(db, { limit: 2 })).toHaveLength(2);
    });

    it('returns an empty array when nothing has ever been dismissed with a reason', () => {
        const db = makeDb();
        upsertSeenCandidate(db, candidate());
        expect(listRejectionReasons(db)).toEqual([]);
    });
});
