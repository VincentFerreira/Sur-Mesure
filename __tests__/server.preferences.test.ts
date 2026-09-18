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
    // Absent from a never-saved file means "all scraper sources enabled" — the
    // implicit behavior this codebase already had before enabledPortals existed.
    expect(res.body.enabledPortals).toEqual(['france_travail', 'arbeitnow', 'freehire', 'claude_cli']);
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

  it('rejects an enabledPortals entry that is not a known portal id', async () => {
    const res = await request(app).put('/api/preferences').send({ enabledPortals: ['france_travail', 'bogus_portal'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_enabled_portals');
  });

  it('accepts a valid enabledPortals subset, deduped', async () => {
    const res = await request(app).put('/api/preferences').send({ enabledPortals: ['arbeitnow', 'freehire', 'arbeitnow'] });
    expect(res.status).toBe(200);
    expect(res.body.enabledPortals).toEqual(['arbeitnow', 'freehire']);
  });

  it('rejects a negative searchBudgetUsd', async () => {
    const res = await request(app).put('/api/preferences').send({ searchBudgetUsd: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_search_budget');
  });

  it('rejects an out-of-range autoDismissBelowScore', async () => {
    const res = await request(app).put('/api/preferences').send({ autoDismissBelowScore: 150 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_auto_dismiss_score');
  });

  it('accepts valid searchBudgetUsd and autoDismissBelowScore values', async () => {
    const res = await request(app).put('/api/preferences').send({ searchBudgetUsd: 2.5, autoDismissBelowScore: 60 });
    expect(res.status).toBe(200);
    expect(res.body.searchBudgetUsd).toBe(2.5);
    expect(res.body.autoDismissBelowScore).toBe(60);
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

  it('accepts franceTravailClientId/_ClientSecret, round-trips the id plainly, and reports the secret as a boolean without ever returning it', async () => {
    const res = await request(app)
      .put('/api/preferences')
      .send({ franceTravailClientId: 'my-client-id', franceTravailClientSecret: 'super-secret' });
    expect(res.status).toBe(200);
    expect(res.body.franceTravailClientId).toBe('my-client-id');
    expect(res.body.franceTravailClientSecretConfigured).toBe(true);
    expect(res.body.franceTravailClientSecret).toBeUndefined();
  });

  it('GET also never returns the raw secret, only franceTravailClientSecretConfigured', async () => {
    const res = await request(app).get('/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.franceTravailClientSecretConfigured).toBe(true);
    expect(res.body.franceTravailClientSecret).toBeUndefined();
  });

  // Deliberately NOT full-replace, unlike every other field in this handler — see
  // server/routes.preferences.js: omitting the key means "leave the stored secret
  // alone," so a routine save that never touches this field (e.g. just editing job
  // titles) can't accidentally wipe a working credential.
  it('omitting franceTravailClientSecret on a later save preserves the previously-stored one', async () => {
    const res = await request(app).put('/api/preferences').send({ jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.franceTravailClientSecretConfigured).toBe(true);
  });

  it('sending an explicit empty string clears the stored secret', async () => {
    const res = await request(app).put('/api/preferences').send({ franceTravailClientSecret: '' });
    expect(res.status).toBe(200);
    expect(res.body.franceTravailClientSecretConfigured).toBe(false);
  });

  it('resets to empty/undefined via an empty-body PUT (full-replace semantics)', async () => {
    const res = await request(app).put('/api/preferences').send({});
    expect(res.status).toBe(200);
    expect(res.body.jobTitles).toEqual([]);
    expect(res.body.locations).toEqual([]);
    expect(res.body.workModes).toEqual([]);
    expect(res.body.cvId).toBeUndefined();
    expect(res.body.minGrossAnnualSalary).toBeUndefined();
    // Full-replace semantics apply here too — an omitted enabledPortals on a PUT
    // resets to undefined, not back to defaultPreferences()'s "all enabled" (that
    // default only ever applies to a GET on a file that was never saved at all).
    expect(res.body.enabledPortals).toBeUndefined();
  });
});
