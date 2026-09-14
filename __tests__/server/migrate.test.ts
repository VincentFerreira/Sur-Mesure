import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateLegacyCvs, migrateScraperCandidatesToSqlite } from '../../server/migrate.js';
import { getCandidate } from '../../server/scraperCandidatesStore.js';

let legacyDir: string;
let dataDir: string;

afterEach(() => {
    if (legacyDir) fs.rmSync(legacyDir, { recursive: true, force: true });
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeDirs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-migrate-test-'));
    legacyDir = path.join(root, 'cvs');
    dataDir = path.join(root, 'data');
    fs.mkdirSync(legacyDir, { recursive: true });
    return { legacyDir, dataDir };
}

describe('migrateLegacyCvs', () => {
    it('copies legacy CV files into dataDir/cvs and writes a report marker', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify({ id: 'a' }));
        fs.writeFileSync(path.join(legacyDir, 'b.json'), JSON.stringify({ id: 'b' }));

        const result = await migrateLegacyCvs({ legacyDir, dataDir });

        expect(result).toEqual({ migrated: true, count: 2 });
        expect(fs.existsSync(path.join(dataDir, 'cvs', 'a.json'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'cvs', 'b.json'))).toBe(true);

        const marker = JSON.parse(fs.readFileSync(path.join(dataDir, '.migrated'), 'utf-8'));
        expect(marker.count).toBe(2);
        expect(marker.files.sort()).toEqual(['a.json', 'b.json']);
    });

    it('never modifies or deletes the legacy files', async () => {
        const { legacyDir, dataDir } = makeDirs();
        const content = JSON.stringify({ id: 'a', name: 'Original' });
        fs.writeFileSync(path.join(legacyDir, 'a.json'), content);

        await migrateLegacyCvs({ legacyDir, dataDir });

        expect(fs.readFileSync(path.join(legacyDir, 'a.json'), 'utf-8')).toBe(content);
    });

    it('is a no-op on a second run (marker already present)', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify({ id: 'a' }));
        await migrateLegacyCvs({ legacyDir, dataDir });

        // Simulate a file added to the legacy dir after migration already ran once.
        fs.writeFileSync(path.join(legacyDir, 'b.json'), JSON.stringify({ id: 'b' }));
        const second = await migrateLegacyCvs({ legacyDir, dataDir });

        expect(second).toEqual({ migrated: false, count: 0 });
        expect(fs.existsSync(path.join(dataDir, 'cvs', 'b.json'))).toBe(false);
    });

    it('does not overwrite a destination file that already exists', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.mkdirSync(path.join(dataDir, 'cvs'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'cvs', 'a.json'), JSON.stringify({ id: 'a', name: 'Already migrated' }));
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify({ id: 'a', name: 'Legacy version' }));

        await migrateLegacyCvs({ legacyDir, dataDir });

        const dest = JSON.parse(fs.readFileSync(path.join(dataDir, 'cvs', 'a.json'), 'utf-8'));
        expect(dest.name).toBe('Already migrated');
    });

    it('handles a missing legacy directory gracefully', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-migrate-test-'));
        dataDir = path.join(root, 'data');
        legacyDir = path.join(root, 'does-not-exist');

        const result = await migrateLegacyCvs({ legacyDir, dataDir });

        expect(result).toEqual({ migrated: true, count: 0 });
        expect(fs.existsSync(path.join(dataDir, 'cvs'))).toBe(true);
    });
});

describe('migrateScraperCandidatesToSqlite', () => {
    let dbHandles: { close: () => void }[] = [];

    afterEach(() => {
        for (const db of dbHandles) db.close();
        dbHandles = [];
    });

    function candidate(overrides: Record<string, unknown> = {}) {
        const now = new Date().toISOString();
        return {
            id: 'a',
            dedupeKey: 'dk-a',
            portal: 'france_travail',
            title: 'QA Engineer',
            company: 'Acme',
            url: 'https://example.test/a',
            status: 'new',
            isRemote: false,
            firstSeenAt: now,
            updatedAt: now,
            ...overrides,
        };
    }

    // Reuses makeDirs()'s `legacyDir` directly as the source of scraper-candidate JSON
    // files — its "cvs" name is incidental (it's just a scratch temp dir shared with
    // the CV-migration tests above), and reusing it (rather than a sibling directory)
    // keeps every file this suite creates under the paths the top-level afterEach
    // already cleans up.

    it('imports legacy JSON files into a fresh database, readable via getCandidate', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify(candidate()));

        const dbPath = path.join(dataDir, 'scraper-candidates.sqlite');
        const result = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath });
        dbHandles.push(result.db);

        expect(result.migrated).toBe(true);
        expect(result.count).toBe(1);
        expect(getCandidate(result.db, 'a')).toMatchObject({ id: 'a', title: 'QA Engineer' });
        expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('is a no-op on a second call now that the db file exists', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify(candidate()));
        const dbPath = path.join(dataDir, 'scraper-candidates.sqlite');

        const first = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath });
        dbHandles.push(first.db);

        // A file added to the legacy dir after migration already ran once must not
        // be picked up by a second call — the db file's existence alone gates this.
        fs.writeFileSync(path.join(legacyDir, 'b.json'), JSON.stringify(candidate({ id: 'b', dedupeKey: 'dk-b' })));
        const second = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath });
        dbHandles.push(second.db);

        expect(second.migrated).toBe(false);
        expect(second.count).toBe(0);
        expect(getCandidate(second.db, 'b')).toBeUndefined();
    });

    it('never modifies or deletes the legacy files', async () => {
        const { legacyDir, dataDir } = makeDirs();
        const content = JSON.stringify(candidate());
        fs.writeFileSync(path.join(legacyDir, 'a.json'), content);
        const dbPath = path.join(dataDir, 'scraper-candidates.sqlite');

        const result = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath });
        dbHandles.push(result.db);

        expect(fs.readFileSync(path.join(legacyDir, 'a.json'), 'utf-8')).toBe(content);
    });

    it('skips a malformed legacy file without throwing, and still imports the rest', async () => {
        const { legacyDir, dataDir } = makeDirs();
        fs.writeFileSync(path.join(legacyDir, 'broken.json'), '{not valid json');
        fs.writeFileSync(path.join(legacyDir, 'a.json'), JSON.stringify(candidate()));
        const dbPath = path.join(dataDir, 'scraper-candidates.sqlite');

        const result = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath });
        dbHandles.push(result.db);

        expect(result.count).toBe(1);
        expect(getCandidate(result.db, 'a')).toMatchObject({ id: 'a' });
    });

    it('handles a missing legacy directory gracefully', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-migrate-test-'));
        dataDir = path.join(root, 'data');
        legacyDir = path.join(root, 'does-not-exist');

        const result = await migrateScraperCandidatesToSqlite({ legacyDir, dbPath: path.join(dataDir, 'scraper-candidates.sqlite') });
        dbHandles.push(result.db);

        expect(result).toMatchObject({ migrated: true, count: 0 });
    });
});
