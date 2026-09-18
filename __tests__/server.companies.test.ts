import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

// Tests run against an isolated temp YARB_DATA_DIR (see tests/setup/serverTestData.ts),
// removed automatically after this file finishes.

const jobIdsToClean: string[] = [];
const companyIdsToClean: string[] = [];

afterAll(async () => {
  for (const id of jobIdsToClean) {
    await request(app).delete(`/api/jobs/${id}`);
  }
  for (const id of companyIdsToClean) {
    await request(app).delete(`/api/companies/${id}`);
  }
});

describe('GET /api/companies', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/companies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/companies', () => {
  it('creates a company with defaults', async () => {
    const res = await request(app).post('/api/companies').send({ name: 'Acme Corp' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Acme Corp');
    expect(typeof res.body.createdAt).toBe('string');
    companyIdsToClean.push(res.body.id);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/companies').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code');
  });

  it('returns 400 for an invalid size', async () => {
    const res = await request(app).post('/api/companies').send({ name: 'Bad Size Co', size: 'huge' });
    expect(res.status).toBe(400);
  });

  it('is idempotent by normalized name: re-posting the same name (case/whitespace variant) returns the existing record', async () => {
    const first = await request(app).post('/api/companies').send({ name: 'Dedup Co' });
    companyIdsToClean.push(first.body.id);

    const second = await request(app).post('/api/companies').send({ name: '  dedup co  ' });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const list = await request(app).get('/api/companies?q=Dedup');
    const matches = list.body.filter((c: { name: string }) => c.name.toLowerCase() === 'dedup co');
    expect(matches).toHaveLength(1);
  });

  it('auto-links existing jobs whose company name matches, case-insensitively', async () => {
    const job = await request(app)
      .post('/api/jobs')
      .send({ company: 'Linkco', title: 'QA Engineer', descriptionRaw: 'desc' });
    jobIdsToClean.push(job.body.id);
    expect(job.body.companyId).toBeUndefined();

    const company = await request(app).post('/api/companies').send({ name: 'linkco' });
    companyIdsToClean.push(company.body.id);

    const updatedJob = await request(app).get(`/api/jobs/${job.body.id}`);
    expect(updatedJob.body.companyId).toBe(company.body.id);
  });
});

describe('POST /api/companies/bulk', () => {
  it('returns 400 for an empty names array', async () => {
    const res = await request(app).post('/api/companies/bulk').send({ names: [] });
    expect(res.status).toBe(400);
  });

  it('creates new names, skips already-existing ones, and dedupes within the batch', async () => {
    const existing = await request(app).post('/api/companies').send({ name: 'Bulk Existing' });
    companyIdsToClean.push(existing.body.id);

    const res = await request(app)
      .post('/api/companies/bulk')
      .send({ names: ['Bulk New A', 'Bulk New A', 'Bulk Existing', 'Bulk New B'] });

    expect(res.status).toBe(200);
    expect(res.body.created.map((c: { name: string }) => c.name)).toEqual(['Bulk New A', 'Bulk New B']);
    expect(res.body.skipped).toEqual(['Bulk Existing']);
    companyIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

  it('re-running the same bulk call skips everything the second time', async () => {
    const first = await request(app).post('/api/companies/bulk').send({ names: ['Rerun Co'] });
    companyIdsToClean.push(...first.body.created.map((c: { id: string }) => c.id));

    const second = await request(app).post('/api/companies/bulk').send({ names: ['Rerun Co'] });
    expect(second.body.created).toEqual([]);
    expect(second.body.skipped).toEqual(['Rerun Co']);
  });

  it('auto-links matching jobs for each created company', async () => {
    const job = await request(app)
      .post('/api/jobs')
      .send({ company: 'Bulk Linkco', title: 'QA Engineer', descriptionRaw: 'desc' });
    jobIdsToClean.push(job.body.id);

    const res = await request(app).post('/api/companies/bulk').send({ names: ['Bulk Linkco'] });
    companyIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));

    const updatedJob = await request(app).get(`/api/jobs/${job.body.id}`);
    expect(updatedJob.body.companyId).toBe(res.body.created[0].id);
  });
});

describe('PATCH /api/companies/:id', () => {
  it('updates fields', async () => {
    const created = await request(app).post('/api/companies').send({ name: 'Patch Co' });
    companyIdsToClean.push(created.body.id);

    const res = await request(app)
      .patch(`/api/companies/${created.body.id}`)
      .send({ location: 'Paris', next40: true });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe('Paris');
    expect(res.body.next40).toBe(true);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .patch('/api/companies/00000000-0000-0000-0000-000000000000')
      .send({ location: 'Nowhere' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid size', async () => {
    const created = await request(app).post('/api/companies').send({ name: 'Patch Size Co' });
    companyIdsToClean.push(created.body.id);

    const res = await request(app).patch(`/api/companies/${created.body.id}`).send({ size: 'huge' });
    expect(res.status).toBe(400);
  });

  it('re-runs the auto-link backfill when the name changes', async () => {
    const job = await request(app)
      .post('/api/jobs')
      .send({ company: 'Renamed Target', title: 'QA Engineer', descriptionRaw: 'desc' });
    jobIdsToClean.push(job.body.id);

    const company = await request(app).post('/api/companies').send({ name: 'Old Name Co' });
    companyIdsToClean.push(company.body.id);

    const renamed = await request(app)
      .patch(`/api/companies/${company.body.id}`)
      .send({ name: 'Renamed Target' });
    expect(renamed.status).toBe(200);

    const updatedJob = await request(app).get(`/api/jobs/${job.body.id}`);
    expect(updatedJob.body.companyId).toBe(company.body.id);
  });
});

describe('DELETE /api/companies/:id', () => {
  it('deletes a company with no linked jobs', async () => {
    const created = await request(app).post('/api/companies').send({ name: 'Delete Me Co' });
    const res = await request(app).delete(`/api/companies/${created.body.id}`);
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/companies?q=Delete Me Co');
    expect(after.body).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/api/companies/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns 409 company_in_use when a job is still linked', async () => {
    const job = await request(app)
      .post('/api/jobs')
      .send({ company: 'In Use Co', title: 'QA Engineer', descriptionRaw: 'desc' });
    jobIdsToClean.push(job.body.id);

    const company = await request(app).post('/api/companies').send({ name: 'In Use Co' });

    const res = await request(app).delete(`/api/companies/${company.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('company_in_use');

    // Clean up: unlink then delete, so the temp dir doesn't leak state across tests.
    await request(app).delete(`/api/jobs/${job.body.id}`);
    jobIdsToClean.splice(jobIdsToClean.indexOf(job.body.id), 1);
    await request(app).delete(`/api/companies/${company.body.id}`);
  });
});
