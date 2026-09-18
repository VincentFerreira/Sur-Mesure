import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerTestHooks, testHooksEnabled } from '../../server/testHooks.js';
import { openCandidatesDb, getCandidate } from '../../server/scraperCandidatesStore.js';
import { openObservabilityDb } from '../../server/observabilityStore.js';

let dataDir: string;
let candidatesDb: ReturnType<typeof openCandidatesDb>;
let observabilityDb: ReturnType<typeof openObservabilityDb>;
const originalNodeEnv = process.env.NODE_ENV;
const originalTestHooks = process.env.YARB_TEST_HOOKS;

afterEach(() => {
    if (candidatesDb) candidatesDb.close();
    if (observabilityDb) observabilityDb.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    process.env.NODE_ENV = originalNodeEnv;
    if (originalTestHooks === undefined) delete process.env.YARB_TEST_HOOKS;
    else process.env.YARB_TEST_HOOKS = originalTestHooks;
});

function makeApp() {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-testhooks-test-'));
    candidatesDb = openCandidatesDb(path.join(dataDir, 'scraper-candidates.sqlite'));
    observabilityDb = openObservabilityDb(path.join(dataDir, 'observability.sqlite'));
    const app = express();
    app.use(express.json());
    registerTestHooks(app, { dataDir, candidatesDb, observabilityDb });
    return { app, dataDir, candidatesDb };
}

describe('testHooksEnabled', () => {
    it('is true when NODE_ENV=test', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.YARB_TEST_HOOKS;
        expect(testHooksEnabled()).toBe(true);
    });

    it('is true when YARB_TEST_HOOKS=1, regardless of NODE_ENV', () => {
        process.env.NODE_ENV = 'production';
        process.env.YARB_TEST_HOOKS = '1';
        expect(testHooksEnabled()).toBe(true);
    });

    it('is false otherwise', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.YARB_TEST_HOOKS;
        expect(testHooksEnabled()).toBe(false);
    });
});

describe('registerTestHooks — disabled', () => {
    it('does not register the routes when hooks are disabled', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.YARB_TEST_HOOKS;
        const { app } = makeApp();

        const res = await request(app).post('/api/__test__/reset');
        expect(res.status).toBe(404);
    });
});

describe('registerTestHooks — enabled', () => {
    it('reset wipes the data directory and recreates cvs/', async () => {
        process.env.NODE_ENV = 'test';
        const { app, dataDir } = makeApp();
        fs.mkdirSync(path.join(dataDir, 'cvs'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'cvs', 'leftover.json'), '{}');

        const res = await request(app).post('/api/__test__/reset');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(fs.existsSync(path.join(dataDir, 'cvs', 'leftover.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'cvs'))).toBe(true);
    });

    it('seed writes the provided CVs into cvs/', async () => {
        process.env.NODE_ENV = 'test';
        const { app, dataDir } = makeApp();

        const res = await request(app)
            .post('/api/__test__/seed')
            .send({ cvs: [{ id: 'seed-1', name: 'Seeded CV', data: {} }] });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, seeded: { cvs: 1, scrapedJobs: 0, jobs: 0 } });
        const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'cvs', 'seed-1.json'), 'utf-8'));
        expect(written.name).toBe('Seeded CV');
    });

    it('seed writes the provided scraped jobs into the scraper-candidates database', async () => {
        process.env.NODE_ENV = 'test';
        const { app, candidatesDb } = makeApp();
        const now = new Date().toISOString();

        const res = await request(app)
            .post('/api/__test__/seed')
            .send({
                scrapedJobs: [
                    {
                        id: 'seed-1',
                        dedupeKey: 'dk-seed-1',
                        portal: 'france_travail',
                        title: 'QA Engineer',
                        company: 'Acme',
                        url: 'https://example.test/seed-1',
                        status: 'new',
                        firstSeenAt: now,
                        updatedAt: now,
                    },
                ],
            });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, seeded: { cvs: 0, scrapedJobs: 1, jobs: 0 } });
        const written = getCandidate(candidatesDb, 'seed-1');
        expect(written?.title).toBe('QA Engineer');
    });

    it('seed writes the provided jobs into jobs/, preserving arbitrary event timestamps', async () => {
        process.env.NODE_ENV = 'test';
        const { app, dataDir } = makeApp();

        const res = await request(app)
            .post('/api/__test__/seed')
            .send({
                jobs: [
                    {
                        id: 'seed-1',
                        company: 'Acme',
                        title: 'QA Engineer',
                        status: 'interview',
                        createdAt: '2026-01-01T00:00:00.000Z',
                        events: [{ id: 'e1', type: 'status_change', from: 'applied', to: 'interview', at: '2026-01-10T00:00:00.000Z' }],
                    },
                ],
            });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, seeded: { cvs: 0, scrapedJobs: 0, jobs: 1 } });
        const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', 'seed-1.json'), 'utf-8'));
        expect(written.status).toBe('interview');
        expect(written.events[0].at).toBe('2026-01-10T00:00:00.000Z');
    });
});
