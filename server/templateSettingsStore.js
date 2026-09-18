import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// SQLite-backed singleton settings row for the LaTeX template (currently just the
// chosen font, see lib/fonts.ts on the client) — same node:sqlite/DatabaseSync
// approach as server/scraperCandidatesStore.js, chosen over another flat JSON file
// under data/ per explicit request, so future template-level settings have a proper
// table to land in instead of another one-off JSON singleton.
//
// 'raleway' below mirrors DEFAULT_FONT_ID in lib/fonts.ts (a plain TS file the server
// can't import); keep the two in sync by hand, same kind of duplication already
// accepted across the JS/TS server/client boundary elsewhere in this codebase.
const DEFAULT_FONT_ID = 'raleway';

function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS template_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        font_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    db.prepare(
        'INSERT OR IGNORE INTO template_settings (id, font_id, updated_at) VALUES (1, ?, ?)'
    ).run(DEFAULT_FONT_ID, new Date().toISOString());
}

export function openTemplateSettingsDb(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    ensureSchema(db);
    return db;
}

function rowToSettings(row) {
    return { fontId: row.font_id, updatedAt: row.updated_at };
}

export function getTemplateSettings(db) {
    return rowToSettings(db.prepare('SELECT * FROM template_settings WHERE id = 1').get());
}

export function updateTemplateSettings(db, { fontId }) {
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE template_settings SET font_id = ?, updated_at = ? WHERE id = 1').run(fontId, updatedAt);
    return { fontId, updatedAt };
}
