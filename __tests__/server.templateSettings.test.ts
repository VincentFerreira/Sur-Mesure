import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

// Tests run against an isolated temp YARB_DATA_DIR (see tests/setup/serverTestData.ts).
// Like preferences, there is only ever one template-settings record — no per-test id
// cleanup array needed.

describe('GET /api/template-settings', () => {
  it('returns the default fontId before anything is saved', async () => {
    const res = await request(app).get('/api/template-settings');
    expect(res.status).toBe(200);
    expect(res.body.fontId).toBe('raleway');
    expect(typeof res.body.updatedAt).toBe('string');
  });
});

describe('PUT /api/template-settings', () => {
  it('rejects a missing fontId', async () => {
    const res = await request(app).put('/api/template-settings').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_font_id');
  });

  it('rejects an empty-string fontId', async () => {
    const res = await request(app).put('/api/template-settings').send({ fontId: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_font_id');
  });

  it('rejects a non-string fontId', async () => {
    const res = await request(app).put('/api/template-settings').send({ fontId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_font_id');
  });

  it('accepts a valid fontId and round-trips it through a subsequent GET', async () => {
    const put = await request(app).put('/api/template-settings').send({ fontId: 'charter' });
    expect(put.status).toBe(200);
    expect(put.body.fontId).toBe('charter');
    expect(typeof put.body.updatedAt).toBe('string');

    const get = await request(app).get('/api/template-settings');
    expect(get.body.fontId).toBe('charter');
  });
});
