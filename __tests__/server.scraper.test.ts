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

describe('GET /api/scraper/run/progress', () => {
  it('reports inactive with no events when no run has ever started in this process', async () => {
    const res = await request(app).get('/api/scraper/run/progress');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('active');
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('is inactive again once a run has completed (the fake portal has nothing to narrate, but the run/progress lifecycle still brackets it)', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Progress Lifecycle Test Engineer'], locations: ['Paris'] });
    const run = await request(app).post('/api/scraper/run');
    candidateIdsToClean.push(...run.body.created.map((c: { id: string }) => c.id));

    const res = await request(app).get('/api/scraper/run/progress');
    expect(res.body.active).toBe(false);
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
    // Wiring smoke test for the relevance pre-filter (server/scraperRelevance.js) — the
    // fake portal's search() always echoes the query back as the title, so it can never
    // produce an off-topic result to actually drop here; the filtering logic itself is
    // covered by __tests__/server/scraperRelevance.test.ts.
    expect(typeof res.body.filteredCounts).toBe('object');

    const candidate = res.body.created[0];
    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('dedupeKey');
    expect(candidate.status).toBe('new');
    // Ingest-time normalization (server/scraperNormalize.js) wiring: fake.js's search()
    // always returns a well-formed title/company, so this only checks the fields exist
    // with the right types — the actual title-case/department/fallback behavior under
    // input is covered by __tests__/server/scraperNormalize.test.ts.
    expect(typeof candidate.isRemote).toBe('boolean');
    expect(candidate.company.length).toBeGreaterThan(0);
    candidateIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

  it('does not duplicate candidates already seen in a previous run', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['QA Automation Engineer'], locations: ['Paris'] });

    const first = await request(app).post('/api/scraper/run');
    candidateIdsToClean.push(...first.body.created.map((c: { id: string }) => c.id));

    const second = await request(app).post('/api/scraper/run');
    expect(second.body.created).toHaveLength(0);
  });

  it('excludes the fake portal — and produces no candidates — when preferences.enabledPortals excludes it', async () => {
    // 'fake' isn't itself a user-selectable id (server/routes.preferences.js's
    // enabledPortals whitelist is the 4 real portal ids from types.ts's
    // SCRAPER_PORTAL_IDS), so listing any subset of real ids here still excludes
    // 'fake' from runScrape's filter — an indirect but real end-to-end check that
    // the preference reaches runScrape and actually filters.
    await request(app).put('/api/preferences').send({ jobTitles: ['QA Engineer'], locations: ['Paris'], enabledPortals: ['arbeitnow'] });
    const res = await request(app).post('/api/scraper/run');
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.portalReport).toEqual([]);
  });

  it('omitting enabledPortals keeps the fake portal running, unchanged from before this preference existed', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['QA Engineer'], locations: ['Paris'] });
    const res = await request(app).post('/api/scraper/run');
    expect(res.status).toBe(200);
    expect(res.body.portalReport).toEqual(expect.arrayContaining([expect.objectContaining({ portal: 'fake' })]));
    candidateIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

  it('uses jobTitles from the request body instead of preferences when provided (AI-expanded keyword list)', async () => {
    // Preferences are deliberately left empty (see afterEach) — the override alone
    // must be enough to run, and must not be rejected as "preferences_incomplete".
    const res = await request(app).post('/api/scraper/run').send({ jobTitles: ['Platform Reliability Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.created.length).toBeGreaterThan(0);
    candidateIdsToClean.push(...res.body.created.map((c: { id: string }) => c.id));
  });

  it('a re-scraped candidate only gets last_seen_at touched — status and viewedAt survive', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Fingerprint Resurface Engineer'], locations: ['Paris'] });

    const first = await request(app).post('/api/scraper/run');
    const candidate = first.body.created[0];
    candidateIdsToClean.push(candidate.id);
    expect(candidate.fingerprint).toBeTruthy();
    expect(candidate.viewedAt).toBeFalsy();

    // A human triages it: dismissed, then viewed.
    await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ status: 'dismissed' });
    await request(app).post('/api/scraper/candidates/mark-viewed').send({ ids: [candidate.id] });
    const beforeRescrape = (await request(app).get('/api/scraper/candidates')).body.find((c: { id: string }) => c.id === candidate.id);
    expect(beforeRescrape.status).toBe('dismissed');
    expect(beforeRescrape.viewedAt).toBeTruthy();

    // Re-running with the identical inputs must not create a duplicate, and must not
    // undo either the dismissal or the viewed mark — the literal spec's core guarantee
    // ("une offre écartée qui remonte ne redevient pas neuve").
    const second = await request(app).post('/api/scraper/run');
    expect(second.body.created).toHaveLength(0);

    const afterRescrape = (await request(app).get('/api/scraper/candidates')).body.find((c: { id: string }) => c.id === candidate.id);
    expect(afterRescrape.status).toBe('dismissed');
    expect(afterRescrape.viewedAt).toBe(beforeRescrape.viewedAt);
    expect(afterRescrape.lastSeenAt >= beforeRescrape.lastSeenAt).toBe(true);
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
  it('returns an empty results map when there are no candidates or job titles', async () => {
    const res = await request(app).post('/api/scraper/qualify').send({ candidates: [], jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({});
  });

  it('judges candidate fit/score/signals via the fake AI stand-in (NODE_ENV=test)', async () => {
    const res = await request(app)
      .post('/api/scraper/qualify')
      .send({ candidates: [{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }], jobTitles: ['QA Engineer'] });
    expect(res.status).toBe(200);
    expect(res.body.results['1'].fit).toBe('high');
    expect(typeof res.body.results['1'].score).toBe('number');
    expect(Array.isArray(res.body.results['1'].signals)).toBe(true);
  });

  it('downgrades and tags a candidate whose work mode is incompatible with the configured preferences', async () => {
    const res = await request(app)
      .post('/api/scraper/qualify')
      .send({
        candidates: [
          {
            id: '1',
            title: 'Senior QA Engineer',
            company: 'Acme',
            location: 'Paris',
            descriptionRaw: 'Poste 100% présentiel, aucun télétravail possible.',
          },
        ],
        jobTitles: ['QA Engineer'],
        workModes: ['hybrid', 'remote'],
      });
    expect(res.status).toBe(200);
    expect(res.body.results['1'].fit).toBe('medium');
    expect(res.body.results['1'].signals).toContainEqual({ label: 'Sur site non souhaité', polarity: 'negative' });
  });

  // The point of the whole feature: a reason typed once on a past dismissal should
  // change how a *different*, later candidate from the same company scores — proven
  // end to end here (dismiss with reason -> qualify a new candidate -> downgraded),
  // not just at the claudeCli/fake unit level.
  it('downgrades a new candidate sharing a company with a previously-dismissed-with-reason candidate', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Memory Wiring Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const rejected = run.body.created[0];
    candidateIdsToClean.push(rejected.id);
    await request(app)
      .patch(`/api/scraper/candidates/${rejected.id}`)
      .send({ status: 'dismissed', dismissReason: 'ESN / régie' });

    const res = await request(app)
      .post('/api/scraper/qualify')
      .send({
        candidates: [{ id: 'new-1', title: 'Memory Wiring Engineer', company: rejected.company }],
        jobTitles: ['Memory Wiring Engineer'],
      });
    expect(res.status).toBe(200);
    expect(res.body.results['new-1'].signals).toContainEqual({ label: 'Comme rejet précédent', polarity: 'negative' });
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

  it('persists an optional reason given alongside a dismissal', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Reason Capture Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const res = await request(app)
      .patch(`/api/scraper/candidates/${candidate.id}`)
      .send({ status: 'dismissed', dismissReason: 'ESN / régie' });
    expect(res.status).toBe(200);
    expect(res.body.dismissReason).toBe('ESN / régie');

    const fetched = (await request(app).get('/api/scraper/candidates')).body.find((c: { id: string }) => c.id === candidate.id);
    expect(fetched.dismissReason).toBe('ESN / régie');
  });

  it('accepts a reason added as a follow-up PATCH on an already-dismissed candidate', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Followup Reason Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ status: 'dismissed' });
    const res = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ dismissReason: 'Salaire trop bas' });
    expect(res.status).toBe(200);
    expect(res.body.dismissReason).toBe('Salaire trop bas');
    expect(res.body.status).toBe('dismissed');
  });

  it('rejects a dismissReason longer than the allowed length', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Too Long Reason Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const res = await request(app)
      .patch(`/api/scraper/candidates/${candidate.id}`)
      .send({ status: 'dismissed', dismissReason: 'x'.repeat(301) });
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'invalid_dismiss_reason');
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

  it('stores fit, score and signals together and rejects an invalid score or signals', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Platform Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    const invalidScore = await request(app).patch(`/api/scraper/candidates/${candidate.id}`).send({ score: 150 });
    expect(invalidScore.status).toBe(400);
    expect(invalidScore.body.error).toHaveProperty('code', 'invalid_score');

    const invalidSignals = await request(app)
      .patch(`/api/scraper/candidates/${candidate.id}`)
      .send({ signals: [{ label: 'x', polarity: 'bogus' }] });
    expect(invalidSignals.status).toBe(400);
    expect(invalidSignals.body.error).toHaveProperty('code', 'invalid_signals');

    const res = await request(app)
      .patch(`/api/scraper/candidates/${candidate.id}`)
      .send({ fit: 'high', score: 90, signals: [{ label: 'Playwright', polarity: 'positive' }] });
    expect(res.status).toBe(200);
    expect(res.body.fit).toBe('high');
    expect(res.body.score).toBe(90);
    expect(res.body.signals).toEqual([{ label: 'Playwright', polarity: 'positive' }]);
  });
});

describe('POST /api/scraper/candidates/mark-viewed', () => {
  it('marks the given candidates as viewed and returns the count actually changed', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Mark Viewed Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);
    expect(candidate.viewedAt).toBeFalsy();

    const res = await request(app).post('/api/scraper/candidates/mark-viewed').send({ ids: [candidate.id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const fetched = (await request(app).get('/api/scraper/candidates')).body.find((c: { id: string }) => c.id === candidate.id);
    expect(fetched.viewedAt).toBeTruthy();
  });

  it('does not re-count or re-stamp an already-viewed candidate on a second call', async () => {
    await request(app).put('/api/preferences').send({ jobTitles: ['Mark Viewed Twice Engineer'], locations: [] });
    const run = await request(app).post('/api/scraper/run');
    const candidate = run.body.created[0];
    candidateIdsToClean.push(candidate.id);

    await request(app).post('/api/scraper/candidates/mark-viewed').send({ ids: [candidate.id] });
    const second = await request(app).post('/api/scraper/candidates/mark-viewed').send({ ids: [candidate.id] });
    expect(second.body.count).toBe(0);
  });

  it('returns count 0 for an empty ids array', async () => {
    const res = await request(app).post('/api/scraper/candidates/mark-viewed').send({ ids: [] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
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
