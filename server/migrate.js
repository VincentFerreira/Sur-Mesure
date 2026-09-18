import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { openCandidatesDb, upsertCandidateRaw } from './scraperCandidatesStore.js';

// One-time, non-destructive migration of the legacy flat `cvs/` directory
// into `YARB_DATA_DIR/cvs/`. Never deletes or modifies the legacy files.
export async function migrateLegacyCvs({ legacyDir, dataDir }) {
    const migratedMarker = path.join(dataDir, '.migrated');
    const cvsDestDir = path.join(dataDir, 'cvs');
    await fsp.mkdir(cvsDestDir, { recursive: true });

    if (fs.existsSync(migratedMarker)) {
        return { migrated: false, count: 0 };
    }

    let files = [];
    if (fs.existsSync(legacyDir)) {
        files = (await fsp.readdir(legacyDir)).filter((f) => f.endsWith('.json'));
    }

    const copied = [];
    for (const file of files) {
        const src = path.join(legacyDir, file);
        const dest = path.join(cvsDestDir, file);
        if (!fs.existsSync(dest)) {
            await fsp.copyFile(src, dest);
            copied.push(file);
        }
    }

    const report = {
        migratedAt: new Date().toISOString(),
        legacyDir,
        cvsDestDir,
        count: copied.length,
        files: copied,
    };
    await fsp.writeFile(migratedMarker, JSON.stringify(report, null, 2));

    if (copied.length > 0) {
        console.log(`[migrate] Copied ${copied.length} legacy CV file(s) from ${legacyDir} to ${cvsDestDir}`);
    }

    return { migrated: true, count: copied.length };
}

// One-time, non-destructive migration of the legacy flat `scraper-candidates/`
// directory (one JSON file per candidate) into a single SQLite database. Never
// deletes or modifies the legacy files — they're left on disk afterward, exactly like
// migrateLegacyCvs above. The `.sqlite` file's own existence is the idempotency
// marker (not a separate marker file — that would incorrectly gate two unrelated
// migrations on the same flag if it reused migrateLegacyCvs's `.migrated`).
export async function migrateScraperCandidatesToSqlite({ legacyDir, dbPath }) {
    const alreadyMigrated = fs.existsSync(dbPath);
    const db = openCandidatesDb(dbPath); // creates the file + schema if missing, else a no-op

    if (alreadyMigrated) {
        return { db, migrated: false, count: 0 };
    }

    let files = [];
    if (fs.existsSync(legacyDir)) {
        files = (await fsp.readdir(legacyDir)).filter((f) => f.endsWith('.json'));
    }

    let count = 0;
    for (const file of files) {
        try {
            const candidate = JSON.parse(await fsp.readFile(path.join(legacyDir, file), 'utf-8'));
            upsertCandidateRaw(db, candidate);
            count += 1;
        } catch (err) {
            // A single malformed legacy file must never block server startup — same
            // per-item error isolation as server/scrapers/index.js's runScrape.
            console.error(`[migrate] Skipped unreadable/invalid legacy candidate file ${file}:`, err.message);
        }
    }

    if (count > 0) {
        console.log(`[migrate] Imported ${count} legacy scraper candidate(s) from ${legacyDir} into ${dbPath}`);
    }

    return { db, migrated: true, count };
}
