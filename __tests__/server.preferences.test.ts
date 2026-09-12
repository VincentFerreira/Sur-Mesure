import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../server.js';

// Tests run against an isolated temp YARB_DATA_DIR (see tests/setup/serverTestData.ts),
// removed automatically after this file finishes. Unlike the collection resources
// (CVs/Jobs/Companies), there is only ever one preferences record, so there's no
// per-test id cleanup array needed.

describe('GET /api/preferences', () => {
  it('returns the default empty shape before anything is saved', async () => {
    const res = await request(app).get('/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.jobTitles).toEqual([]);
    expect(res.body.locations).toEqual([]);
    expect(res.body.workModes).toEqual([]);
    expect(res.body.updatedAt).toBeNull();
  });
});

describe('PUT /api/preferences', () => {
  it('rejects a non-array jobTitles', async () => {
    const res = await request(app).put('/api/preferences').send({ jobTitles: 'QA Engineer' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_job_titles');
  });

  it('rejects a non-array locations', async () => {
    const res = await request(app).put('/api/preferences').send({ locations: 'Paris' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_locations');
  });

  it('rejects an invalid workMode value', async () => {
    const res = await request(app).put('/api/preferences').send({ workModes: ['spaceship'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_work_modes');
  });

  it('rejects a negative minGrossAnnualSalary', async () => {
    const res = await request(app).put('/api/preferences').send({ minGrossAnnualSalary: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_salary');
  });

  it('rejects an unknown cvId', async () => {
    const res = await request(app).put('/api/preferences').send({ cvId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_cv_id');
  });

  it('accepts a valid cvId and round-trips all fields through a subsequent GET', async () => {
    const cv = await request(app).post('/api/cvs').send({ label: 'Prefs CV', data: { currentLanguage: 'fr' } });

    const put = await request(app)
      .put('/api/preferences')
      .send({
        jobTitles: ['QA Engineer', 'SDET', 'QA Engineer'],
        locations: ['Paris', 'Remote France'],
        workModes: ['remote', 'hybrid'],
        minGrossAnnualSalary: 45000,
        cvId: cv.body.id,
      });
    expect(put.status).toBe(200);
    expect(put.body.jobTitles).toEqual(['QA Engineer', 'SDET']); // exact-string dedupe
    expect(typeof put.body.updatedAt).toBe('string');

    const get = await request(app).get('/api/preferences');
    expect(get.body).toMatchObject({
      jobTitles: ['QA Engineer', 'SDET'],
      locations: ['Paris', 'Remote France'],
      workModes: ['remote', 'hybrid'],
      minGrossAnnualSalary: 45000,
      cvId: cv.body.id,
    });

    await request(app).delete(`/api/cvs/${cv.body.id}`);
  });

  it('resets to empty/undefined via an empty-body PUT (full-replace semantics)', async () => {
    const res = await request(app).put('/api/preferences').send({});
    expect(res.status).toBe(200);
    expect(res.body.jobTitles).toEqual([]);
    expect(res.body.locations).toEqual([]);
    expect(res.body.workModes).toEqual([]);
    expect(res.body.cvId).toBeUndefined();
    expect(res.body.minGrossAnnualSalary).toBeUndefined();
  });
});
