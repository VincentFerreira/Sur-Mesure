import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

// Forces the deterministic `fake` portal into the registry (server/scrapers/index.js)
// instead of the real France Travail one, so this suite never needs credentials or
// network access.
const originalScraperProvider = process.env.SCRAPER_PROVIDER;
beforeAll(() => {
  process.env.SCRAPER_PROVIDER = 'fake';
});
afterAll(() => {
  if (originalScraperProvider === undefined) delete process.env.SCRAPER_PROVIDER;
  else process.env.SCRAPER_PROVIDER = originalScraperProvider;
});

const candidateIdsToClean: string[] = [];
const jobIdsToClean: string[] = [];

afterEach(async () => {
  await request(app).put('/api/preferences').send({ jobTitles: [], locations: [] });
});

afterAll(async () => {
  for (const id of candidateIdsToClean) {
    await request(app).delete(`/api/scraper/candidates/${id}`);
  }
  for (const id of jobIdsToClean) {
    await request(app).delete(`/api/jobs/${id}`);
  }
});

describe('GET /api/scraper/candidates', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/scraper/candidates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/scraper/run', () => {
  it('returns 400 when no job titles are configured', async () => {
    const res = await request(app).post('/api/scraper/run');
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'preferences_incomplete');
  });

  it('creates candidates from the fake portal and reports per-portal counts', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['QA Engineer'], locations: ['Paris'] });

    const res = await request(app).post('/api/scraper/run');
    expect(res.status).toBe(200);
    expect(res.body.created.length).toBeGreaterThan(0);
    expect(res.body.portalReport).toEqual(
      expect.arrayContaining([expect.objectContaining({ portal: 'fake', count: expect.any(Number) })])
    );

    const candidate = res.body.created[0];
    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('dedupeKey');
    expect(candidate.status).toBe('new');
    candidateIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

  it('does not duplicate candidates already seen in a previous run', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['QA Automation Engineer'], locations: ['Paris'] });

    const first = await request(app).post('/api/scraper/run');
    candidateIdsToClean.push(...first.body.created.map((c: { id: string }) => c.id));

    const second = await request(app).post('/api/scraper/run');
    expect(second.body.created).toHaveLength(0);
  });

  it('uses jobTitles from the request body instead of preferences when provided (AI-expanded keyword list)', async () => {
    // Preferences are deliberately left empty (see afterEach) — the override alone
    // must be enough to run, and must not be rejected as "preferences_incomplete".
    const res = await request(app).post('/api/scraper/run').send({ jobTitles: ['Platform Reliability Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.created.length).toBeGreaterThan(0);
    candidateIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

});

describe('POST /api/scraper/expand-keywords', () => {
  it('returns an empty array when no job titles are given', async () => {
    const res = await request(app).post('/api/scraper/expand-keywords').send({});
    expect(res.status).toBe(200);
    expect(res.body.jobTitles).toEqual([]);
  });

  it('returns the input unchanged via the fake AI stand-in (NODE_ENV=test)', async () => {
    const res = await request(app).post('/api/scraper/expand-keywords').send({ jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.jobTitles).toEqual(['QA Engineer']);
  });
});

describe('POST /api/scraper/qualify', () => {
  it('returns an empty fitMap when there are no candidates or job titles', async () => {
    const res = await request(app).post('/api/scraper/qualify').send({ candidates: [], jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.fitMap).toEqual({});
  });

  it('judges candidate fit via the fake AI stand-in (NODE_ENV=test)', async () => {
    const res = await request(app)
      .post('/api/scraper/qualify')
      .send({ candidates: [{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }], jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.fitMap['1']).toBe('high');
  });
});

describe('PATCH /api/scraper/candidates/:id', () => {
  it('dismisses a candidate', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Backend Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const res = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ status: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dismissed');
  });

  it('marks a candidate as imported once a real job exists for it', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Frontend Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const jobRes = await request(app)
      .post('/api/jobs')
      .send({ company: candidate.company, title: candidate.title, descriptionRaw: 'Imported from scraper.' });
    jobIdsToClean.push(jobRes.body.id);

    const res = await request(app)
      .patch(`/api/scraper/candidates/${candidate.id}`)
      .send({ status: 'imported', importedJobId: jobRes.body.id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('imported');
    expect(res.body.importedJobId).toBe(jobRes.body.id);
  });

  it('returns 400 when importing without a valid importedJobId', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Data Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const res = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ status: 'imported' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown candidate', async () => {
    const res = await request(app)
      .patch('/api/scraper/candidates/00000000-0000-0000-0000-000000000000')
      .send({ status: 'dismissed' });
    expect(res.status).toBe(404);
  });

  it('stores the AI-computed fit and rejects an invalid value', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Site Reliability Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const invalid = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ fit: 'nonsense' });
    expect(invalid.status).toBe(400);

    const res = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ fit: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.fit).toBe('high');
  });
});

describe('DELETE /api/scraper/candidates/:id', () => {
  it('removes a candidate', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['DevOps Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];

    const res = await request(app).delete(`/api/scraper/candidates/${candidate.id}`);
    expect(res.status).toBe(200);

    const list = await request(app).get('/api/scraper/candidates');
    expect(list.body.find((c: { id: string }) => c.id === candidate.id)).toBeUndefined();
  });
});
