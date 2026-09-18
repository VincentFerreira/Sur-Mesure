import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    openTemplateSettingsDb,
    getTemplateSettings,
    updateTemplateSettings,
} from '../../server/templateSettingsStore.js';

let tempDir: string;
let db: ReturnType<typeof openTemplateSettingsDb>;

function makeDb() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-template-settings-db-test-'));
    db = openTemplateSettingsDb(path.join(tempDir, 'template-settings.sqlite'));
    return db;
}

afterEach(() => {
    if (db) db.close();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getTemplateSettings', () => {
    it('returns a default fontId on a fresh database', () => {
        const db = makeDb();
        const settings = getTemplateSettings(db);
        expect(settings.fontId).toBe('raleway');
        expect(settings.updatedAt).toBeTruthy();
    });
});

describe('updateTemplateSettings', () => {
    it('persists the new fontId and reflects it on the next read', () => {
        const db = makeDb();
        updateTemplateSettings(db, { fontId: 'charter' });
        expect(getTemplateSettings(db).fontId).toBe('charter');
    });

    it('keeps a single row across repeated updates', () => {
        const db = makeDb();
        updateTemplateSettings(db, { fontId: 'charter' });
        updateTemplateSettings(db, { fontId: 'times' });
        const rows = db.prepare('SELECT * FROM template_settings').all();
        expect(rows).toHaveLength(1);
        expect(getTemplateSettings(db).fontId).toBe('times');
    });
});
