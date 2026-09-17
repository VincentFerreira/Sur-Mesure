import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

function validCall(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'gemini',
    operation: 'analyze_ats',
    model: 'gemini-3.1-flash-lite',
    durationMs: 1234,
    status: 'success',
    promptTokens: 500,
    completionTokens: 200,
    totalTokens: 700,
    ...overrides,
  };
}

describe('POST /api/observability/calls', () => {
  it('logs a valid call and returns it', async () => {
    const res = await request(app).post('/api/observability/calls').send(validCall());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'gemini', operation: 'analyze_ats', status: 'success', totalTokens: 700 });
    expect(res.body.id).toBeTruthy();
    expect(res.body.createdAt).toBeTruthy();
  });

  it('rejects an invalid provider', async () => {
    const res = await request(app).post('/api/observability/calls').send(validCall({ provider: 'openai' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'invalid_provider');
  });

  it('rejects an invalid operation', async () => {
    const res = await request(app).post('/api/observability/calls').send(validCall({ operation: 'bogus' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'invalid_operation');
  });

  it('rejects an invalid status', async () => {
    const res = await request(app).post('/api/observability/calls').send(validCall({ status: 'pending' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'invalid_status');
  });

  it('rejects a negative durationMs', async () => {
    const res = await request(app).post('/api/observability/calls').send(validCall({ durationMs: -1 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'invalid_duration');
  });

  it('accepts an error call with an errorMessage', async () => {
    const res = await request(app)
      .post('/api/observability/calls')
      .send(validCall({ status: 'error', errorMessage: 'Timeout', promptTokens: undefined, completionTokens: undefined, totalTokens: undefined }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.errorMessage).toBe('Timeout');
  });
});

describe('GET /api/observability/calls', () => {
  it('returns 200 with an array including a just-logged call', async () => {
    await request(app).post('/api/observability/calls').send(validCall({ provider: 'claude_cli', operation: 'search_all' }));
    const res = await request(app).get('/api/observability/calls');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((c: { provider: string }) => c.provider === 'claude_cli')).toBe(true);
  });

  it('filters by provider', async () => {
    await request(app).post('/api/observability/calls').send(validCall({ provider: 'fake', operation: 'extract_job' }));
    const res = await request(app).get('/api/observability/calls?provider=fake');
    expect(res.status).toBe(200);
    expect(res.body.every((c: { provider: string }) => c.provider === 'fake')).toBe(true);
  });

  it('supports sinceRowId for polling', async () => {
    const first = await request(app).get('/api/observability/calls?limit=1');
    const sinceRowId = first.body[0]?.rowId ?? 0;
    await request(app).post('/api/observability/calls').send(validCall());
    const res = await request(app).get(`/api/observability/calls?sinceRowId=${sinceRowId}`);
    expect(res.status).toBe(200);
    expect(res.body.every((c: { rowId: number }) => c.rowId > sinceRowId)).toBe(true);
  });
});

describe('GET /api/observability/stats', () => {
  it('returns aggregate stats', async () => {
    await request(app).post('/api/observability/calls').send(validCall());
    const res = await request(app).get('/api/observability/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalCalls');
    expect(res.body).toHaveProperty('totalTokens');
    expect(res.body).toHaveProperty('avgDurationMs');
    expect(res.body).toHaveProperty('errorRate');
    expect(res.body.totalCalls).toBeGreaterThan(0);
  });
});
