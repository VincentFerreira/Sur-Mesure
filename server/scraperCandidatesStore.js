import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { makeFingerprint } from './scraperFingerprint.js';

// SQLite-backed persistence for scraped job candidates — same role as store.js's
// JSON helpers play for cvs/jobs/companies, but scoped to this one entity. Migrated
// off flat JSON files (see server/migrate.js migrateScraperCandidatesToSqlite) because
// this collection has no retention policy and grows unbounded (hundreds of files added
// per scrape run), unlike cvs/jobs/companies which stay small and stay as JSON for
// their git-diffability.
//
// Uses node:sqlite (DatabaseSync), not better-sqlite3: zero new npm dependency, zero
// native compilation step in the Docker build, and this app is a single Node process
// with no concurrent-reader use case that would call for anything more. DatabaseSync's
// calls are synchronous, which actually simplifies concurrency reasoning versus the
// JSON files' per-path write queue (server/store.js's `enqueue`): a synchronous call
// blocks the event loop for its duration, so two SQLite operations from this process
// can never interleave mid-statement.
//
// No SQL-level CHECK constraints on enums (status/fit/signals[].polarity) — validation
// already happens in server/routes.scraper.js before any persistence call, mirroring
// how the JSON files never had schema validation either.

const CANDIDATE_COLUMNS = [
    'id',
    'dedupe_key',
    'fingerprint',
    'external_id',
    'portal',
    'title',
    'company',
    'location',
    'department',
    'is_remote',
    'contract_type',
    'salary_range',
    'url',
    'posted_date',
    'description_raw',
    'fit',
    'score',
    'signals',
    'status',
    'imported_job_id',
    'first_seen_at',
    'last_seen_at',
    'viewed_at',
    'updated_at',
    'dismiss_reason',
];

// `fingerprint`/`external_id`/`last_seen_at`/`viewed_at` are the "never seen before"
// feature's fields — see scraperFingerprint.js. `dedupe_key` is otherwise vestigial:
// new code never reads it to decide "seen before" anymore, it's only still written on
// insert for backward compatibility. It is deliberately NOT UNIQUE (see
// removeDedupeKeyUniqueConstraint below for why a UNIQUE constraint here is actively
// wrong, not just inert). The 4 new columns are nullable at the schema level (this
// file's existing convention — validation lives in routes.scraper.js, not here) so the
// same CREATE TABLE shape works for both a brand new database and, via ALTER TABLE
// below, an existing one that predates this feature.
function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        fingerprint TEXT,
        external_id TEXT,
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
        last_seen_at TEXT,
        viewed_at TEXT,
        updated_at TEXT NOT NULL,
        dismiss_reason TEXT
    )`);

    // Additive migration for a database created before this feature existed — no
    // ALTER TABLE existed anywhere in this codebase before this, so this is the first;
    // standard safe SQLite pattern: detect via PRAGMA table_info, ADD COLUMN if
    // missing, then backfill. Backfilling `fingerprint` MUST recompute it via the real
    // formula (not copy `dedupe_key` verbatim) — the two use different inputs
    // (fingerprint adds department), so a verbatim copy would never match a freshly
    // re-scraped duplicate again, defeating the feature for every pre-existing row.
    const existingColumns = new Set(db.prepare('PRAGMA table_info(candidates)').all().map((c) => c.name));
    const newColumns = ['fingerprint', 'external_id', 'last_seen_at', 'viewed_at', 'dismiss_reason'];
    let migrated = false;
    for (const column of newColumns) {
        if (!existingColumns.has(column)) {
            db.exec(`ALTER TABLE candidates ADD COLUMN ${column} TEXT`);
            migrated = true;
        }
    }
    if (migrated) {
        const legacyRows = db.prepare('SELECT id, company, title, department FROM candidates WHERE fingerprint IS NULL').all();
        db.exec('BEGIN');
        const update = db.prepare('UPDATE candidates SET fingerprint = ?, last_seen_at = updated_at WHERE id = ?');
        for (const row of legacyRows) {
            update.run(makeFingerprint({ company: row.company, title: row.title, department: row.department }), row.id);
        }
        db.exec('COMMIT');
        // viewed_at is deliberately left NULL for every backfilled row — there is no
        // way to know which of these a human already looked at, so they all correctly
        // start as "inédite." One-time, expected consequence, not a bug.
    }

    // `dedupe_key` (company+title slug, no department/portal) is coarser than
    // `fingerprint` (which also factors in department, or a portal external id) — two
    // genuinely different postings (e.g. the same company+title advertised in two
    // different départements) can share a dedupe_key while having distinct
    // fingerprints. upsertSeenCandidate correctly treats them as two separate new
    // candidates (by fingerprint), but a legacy `UNIQUE` constraint on dedupe_key from
    // before fingerprint existed then made the second INSERT throw
    // "UNIQUE constraint failed: candidates.dedupe_key" and abort the whole /run
    // request. SQLite can't drop a column constraint in place, so an existing database
    // still carrying it is rebuilt once, table-copy style, here — after the additive
    // migration above, so every column the rebuild copies is guaranteed to already
    // exist. A brand-new database is already created without the constraint above.
    const existingTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='candidates'").get()?.sql ?? '';
    if (/dedupe_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(existingTableSql)) {
        removeDedupeKeyUniqueConstraint(db);
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_fingerprint ON candidates(fingerprint)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_updated_at ON candidates(updated_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_viewed_at ON candidates(viewed_at)');
}

// Rebuilds `candidates` without the stale `UNIQUE` constraint on dedupe_key —
// SQLite has no `ALTER TABLE ... DROP CONSTRAINT`, so the standard safe pattern is:
// new table with the desired schema, copy every row, drop the old table, rename the
// new one into place. Runs inside a transaction so a mid-copy failure leaves the
// original `candidates` table untouched rather than half-migrated.
function removeDedupeKeyUniqueConstraint(db) {
    db.exec('BEGIN');
    db.exec(`CREATE TABLE candidates__migrating (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        fingerprint TEXT,
        external_id TEXT,
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
        last_seen_at TEXT,
        viewed_at TEXT,
        updated_at TEXT NOT NULL,
        dismiss_reason TEXT
    )`);
    db.exec(`INSERT INTO candidates__migrating (${CANDIDATE_COLUMNS.join(', ')})
        SELECT ${CANDIDATE_COLUMNS.join(', ')} FROM candidates`);
    db.exec('DROP TABLE candidates');
    db.exec('ALTER TABLE candidates__migrating RENAME TO candidates');
    db.exec('COMMIT');
}

export function openCandidatesDb(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    ensureSchema(db);
    return db;
}

// undefined <-> NULL both ways for every optional field — behaviorally identical to the
// old JSON files, where JSON.stringify silently dropped undefined-valued keys (and
// Express's res.json() does the same on the way out, so the wire format for API
// consumers is unaffected either way).
export function candidateToRow(candidate) {
    return {
        id: candidate.id,
        dedupe_key: candidate.dedupeKey,
        // `?? null`, not left unguarded: existing e2e/unit fixtures (seeded via
        // upsertCandidateRaw, bypassing the real ingest path in routes.scraper.js)
        // predate this field and don't set it — node:sqlite throws on an `undefined`
        // bind parameter, so this must degrade to null the same way every other
        // optional column here already does.
        fingerprint: candidate.fingerprint ?? null,
        external_id: candidate.externalId ?? null,
        portal: candidate.portal,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location ?? null,
        department: candidate.department ?? null,
        is_remote: candidate.isRemote ? 1 : 0,
        contract_type: candidate.contractType ?? null,
        salary_range: candidate.salaryRange ?? null,
        url: candidate.url,
        posted_date: candidate.postedDate ?? null,
        description_raw: candidate.descriptionRaw ?? null,
        fit: candidate.fit ?? null,
        score: candidate.score ?? null,
        signals: candidate.signals ? JSON.stringify(candidate.signals) : null,
        status: candidate.status,
        imported_job_id: candidate.importedJobId ?? null,
        first_seen_at: candidate.firstSeenAt,
        last_seen_at: candidate.lastSeenAt ?? null,
        viewed_at: candidate.viewedAt ?? null,
        updated_at: candidate.updatedAt,
        dismiss_reason: candidate.dismissReason ?? null,
    };
}

export function rowToCandidate(row) {
    if (!row) return undefined;
    return {
        id: row.id,
        dedupeKey: row.dedupe_key,
        fingerprint: row.fingerprint ?? undefined,
        externalId: row.external_id ?? undefined,
        portal: row.portal,
        title: row.title,
        company: row.company,
        location: row.location ?? undefined,
        department: row.department ?? undefined,
        isRemote: Boolean(row.is_remote),
        contractType: row.contract_type ?? undefined,
        salaryRange: row.salary_range ?? undefined,
        url: row.url,
        postedDate: row.posted_date ?? undefined,
        descriptionRaw: row.description_raw ?? undefined,
        fit: row.fit ?? undefined,
        score: row.score ?? undefined,
        signals: row.signals ? JSON.parse(row.signals) : undefined,
        status: row.status,
        importedJobId: row.imported_job_id ?? undefined,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at ?? undefined,
        viewedAt: row.viewed_at ?? undefined,
        updatedAt: row.updated_at,
        dismissReason: row.dismiss_reason ?? undefined,
    };
}

export function listCandidates(db, statuses = []) {
    let sql = 'SELECT * FROM candidates';
    const params = [];
    if (statuses.length > 0) {
        sql += ` WHERE status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
    }
    sql += ' ORDER BY updated_at DESC';
    return db.prepare(sql).all(...params).map(rowToCandidate);
}

export function getCandidate(db, id) {
    return rowToCandidate(db.prepare('SELECT * FROM candidates WHERE id = ?').get(id));
}

// The reusable "rejection memory" fed into claudeCli.qualifyAll's prompt (see
// routes.scraper.js POST /qualify) — the most recent dismissed candidates the user
// actually bothered to explain, most-recent-first, capped so the prompt this feeds
// stays a bounded size regardless of how many offers have been dismissed over time.
export function listRejectionReasons(db, { limit = 30 } = {}) {
    return db
        .prepare(
            `SELECT title, company, dismiss_reason FROM candidates
             WHERE status = 'dismissed' AND dismiss_reason IS NOT NULL AND dismiss_reason != ''
             ORDER BY updated_at DESC LIMIT ?`
        )
        .all(limit)
        .map((row) => ({ title: row.title, company: row.company, reason: row.dismiss_reason }));
}

// Inserts a brand-new candidate if `fingerprint` hasn't been seen before, or — if it
// has — touches ONLY `last_seen_at` on the existing row. Never resets `status` or
// `viewed_at` on a touch: a dismissed offer that resurfaces in a later scrape must not
// become "new" again. Checks existence via a SELECT first (cheap, indexed) rather than
// an ON CONFLICT DO UPDATE, since the two branches need genuinely different behavior
// (full insert vs. one-column update) that `.changes` alone can't distinguish — and a
// SELECT-then-branch is safe here since DatabaseSync's calls are synchronous, so there's
// no race between the check and the write within this single process.
export function upsertSeenCandidate(db, candidate) {
    const existing = db.prepare('SELECT id FROM candidates WHERE fingerprint = ?').get(candidate.fingerprint);
    if (existing) {
        db.prepare('UPDATE candidates SET last_seen_at = ? WHERE fingerprint = ?').run(candidate.lastSeenAt, candidate.fingerprint);
        return { isNew: false };
    }
    const row = candidateToRow(candidate);
    const sql = `INSERT INTO candidates (${CANDIDATE_COLUMNS.join(', ')}) VALUES (${CANDIDATE_COLUMNS.map(() => '?').join(', ')})`;
    db.prepare(sql).run(...CANDIDATE_COLUMNS.map((c) => row[c]));
    return { isNew: true };
}

// Marks the given candidates as viewed for the first time — idempotent: an id whose
// viewed_at is already set is left untouched (the first-viewed timestamp sticks, never
// re-stamped on a later call). Returns how many rows were actually changed.
export function markCandidatesViewed(db, ids) {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(', ');
    const result = db.prepare(`UPDATE candidates SET viewed_at = ? WHERE id IN (${placeholders}) AND viewed_at IS NULL`).run(now, ...ids);
    return result.changes;
}

// Full-row overwrite keyed on `id`, ignoring dedupe_key uniqueness — used only by the
// legacy-JSON migration and the test-seed hook, both of which need "put exactly this
// row in the DB" semantics rather than the live scrape path's dedupe-on-insert rule.
export function upsertCandidateRaw(db, candidate) {
    const row = candidateToRow(candidate);
    const nonIdColumns = CANDIDATE_COLUMNS.filter((c) => c !== 'id');
    const sql = `INSERT INTO candidates (${CANDIDATE_COLUMNS.join(', ')})
        VALUES (${CANDIDATE_COLUMNS.map(() => '?').join(', ')})
        ON CONFLICT(id) DO UPDATE SET ${nonIdColumns.map((c) => `${c} = excluded.${c}`).join(', ')}`;
    db.prepare(sql).run(...CANDIDATE_COLUMNS.map((c) => row[c]));
}

// Full-row UPDATE from an already-fully-merged candidate object — the caller
// (routes.scraper.js) keeps doing its existing {...existing, ...overrides} merge in JS;
// only the persistence call changes from writeJsonAtomic to this.
export function updateCandidate(db, candidate) {
    const row = candidateToRow(candidate);
    const nonIdColumns = CANDIDATE_COLUMNS.filter((c) => c !== 'id');
    const sql = `UPDATE candidates SET ${nonIdColumns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...nonIdColumns.map((c) => row[c]), row.id);
    return result.changes > 0;
}

export function deleteCandidate(db, id) {
    const result = db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    return result.changes > 0;
}
