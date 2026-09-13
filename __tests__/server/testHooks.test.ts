import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerTestHooks, testHooksEnabled } from '../../server/testHooks.js';

let dataDir: string;
const originalNodeEnv = process.env.NODE_ENV;
const originalTestHooks = process.env.YARB_TEST_HOOKS;

afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    process.env.NODE_ENV = originalNodeEnv;
    if (originalTestHooks === undefined) delete process.env.YARB_TEST_HOOKS;
    else process.env.YARB_TEST_HOOKS = originalTestHooks;
});

function makeApp() {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-testhooks-test-'));
    const app = express();
    app.use(express.json());
    registerTestHooks(app, { dataDir });
    return { app, dataDir };
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
        expect(res.body).toEqual({ success: true, seeded: { cvs: 1, scrapedJobs: 0 } });
        const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'cvs', 'seed-1.json'), 'utf-8'));
        expect(written.name).toBe('Seeded CV');
    });

    it('seed writes the provided scraped jobs into scraper-candidates/', async () => {
        process.env.NODE_ENV = 'test';
        const { app, dataDir } = makeApp();

        const res = await request(app)
            .post('/api/__test__/seed')
            .send({ scrapedJobs: [{ id: 'seed-1', title: 'QA Engineer', company: 'Acme', status: 'new' }] });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, seeded: { cvs: 0, scrapedJobs: 1 } });
        const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'scraper-candidates', 'seed-1.json'), 'utf-8'));
        expect(written.title).toBe('QA Engineer');
    });
});
