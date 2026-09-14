import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

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
    'updated_at',
];

function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS candidates (
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
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_updated_at ON candidates(updated_at)');
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
        updated_at: candidate.updatedAt,
    };
}

export function rowToCandidate(row) {
    if (!row) return undefined;
    return {
        id: row.id,
        dedupeKey: row.dedupe_key,
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
        updatedAt: row.updated_at,
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

// Returns true if the candidate was actually inserted, false if `dedupeKey` already
// existed (ON CONFLICT DO NOTHING) — this replaces the old in-memory Set scan, and also
// transparently guards against a duplicate dedupeKey appearing twice within the SAME
// scrape run's results, since each .run() call commits immediately.
export function insertCandidateIfNew(db, candidate) {
    const row = candidateToRow(candidate);
    const sql = `INSERT INTO candidates (${CANDIDATE_COLUMNS.join(', ')})
        VALUES (${CANDIDATE_COLUMNS.map(() => '?').join(', ')})
        ON CONFLICT(dedupe_key) DO NOTHING`;
    const result = db.prepare(sql).run(...CANDIDATE_COLUMNS.map((c) => row[c]));
    return result.changes > 0;
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
