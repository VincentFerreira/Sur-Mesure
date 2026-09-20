import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { app } from '../server.js';

// Tests run against an isolated temp YARB_DATA_DIR (see tests/setup/serverTestData.ts),
// removed automatically after this file finishes. Individual tests still clean up
// what they create so describe blocks don't interfere with each other.

let createdId: string;

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ── CV CRUD ───────────────────────────────────────────────────────────────────

describe('GET /api/cvs', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/cvs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/cvs', () => {
  afterAll(async () => {
    if (createdId) {
      await request(app).delete(`/api/cvs/${createdId}`);
    }
  });

  it('creates a CV and returns metadata with an id', async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ label: 'Test CV', data: { currentLanguage: 'fr' } });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.label).toBe('Test CV');
    expect(res.body.language).toBe('fr');
    expect(res.body.tags).toEqual([]);
    expect(res.body).toHaveProperty('contentHash');
    expect(typeof res.body.createdAt).toBe('number');
    createdId = res.body.id;
  });

  it('returns 400 when label is missing', async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ data: { currentLanguage: 'fr' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code');
  });

  it('returns 400 when data is missing', async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ label: 'No Data CV' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/cvs/:id', () => {
  let localId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ label: 'Load Test', data: { currentLanguage: 'en' } });
    localId = res.body.id;
  });

  afterAll(async () => {
    if (localId) await request(app).delete(`/api/cvs/${localId}`);
  });

  it('returns the full CV record', async () => {
    const res = await request(app).get(`/api/cvs/${localId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(localId);
    expect(res.body.label).toBe('Load Test');
    expect(res.body.data.currentLanguage).toBe('en');
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).get('/api/cvs/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown valid UUID', async () => {
    const res = await request(app).get('/api/cvs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  // Regression: CVs written before contentHash existed have no such field on disk.
  // Scoring (POST /:id/score) requires cvContentHash, so a CV stuck without one can
  // never be scored. GET should backfill it lazily rather than leaving it undefined.
  it('backfills contentHash for a legacy CV record that predates the field', async () => {
    const legacyId = randomUUID();
    const cvsDir = path.join(process.env.YARB_DATA_DIR!, 'cvs');
    fs.mkdirSync(cvsDir, { recursive: true });
    const legacyRecord = {
      id: legacyId,
      label: 'Legacy CV',
      language: 'fr',
      tags: [],
      data: { currentLanguage: 'fr' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // no contentHash — simulates a record written before the field existed
    };
    fs.writeFileSync(path.join(cvsDir, `${legacyId}.json`), JSON.stringify(legacyRecord));

    try {
      const res = await request(app).get(`/api/cvs/${legacyId}`);
      expect(res.status).toBe(200);
      expect(res.body.contentHash).toBeTruthy();

      const onDisk = JSON.parse(fs.readFileSync(path.join(cvsDir, `${legacyId}.json`), 'utf-8'));
      expect(onDisk.contentHash).toBe(res.body.contentHash);

      const listRes = await request(app).get('/api/cvs');
      const listed = listRes.body.find((c: any) => c.id === legacyId);
      expect(listed?.contentHash).toBe(res.body.contentHash);
    } finally {
      await request(app).delete(`/api/cvs/${legacyId}`);
    }
  });
});

describe('PUT /api/cvs/:id', () => {
  let localId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ label: 'Before Update', data: { currentLanguage: 'fr' } });
    localId = res.body.id;
  });

  afterAll(async () => {
    if (localId) await request(app).delete(`/api/cvs/${localId}`);
  });

  it('updates the CV label and returns updated metadata', async () => {
    const res = await request(app)
      .put(`/api/cvs/${localId}`)
      .send({ label: 'After Update' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('After Update');
    expect(typeof res.body.updatedAt).toBe('number');
  });

  it('recomputes contentHash when data changes', async () => {
    const before = await request(app).get(`/api/cvs/${localId}`);
    const res = await request(app)
      .put(`/api/cvs/${localId}`)
      .send({ data: { currentLanguage: 'en' } });
    expect(res.body.contentHash).not.toBe(before.body.contentHash);
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).put('/api/cvs/bad-id').send({ label: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown valid UUID', async () => {
    const res = await request(app)
      .put('/api/cvs/00000000-0000-0000-0000-000000000000')
      .send({ label: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cvs/:id', () => {
  let localId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/cvs')
      .send({ label: 'To Delete', data: {} });
    localId = res.body.id;
  });

  it('archives the CV instead of hard-deleting it', async () => {
    const res = await request(app).delete(`/api/cvs/${localId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, archived: true });
  });

  it('excludes the archived CV from the default listing', async () => {
    const res = await request(app).get('/api/cvs');
    expect(res.body.find((c: { id: string }) => c.id === localId)).toBeUndefined();
  });

  it('still returns the archived CV by id, with archivedAt set', async () => {
    const res = await request(app).get(`/api/cvs/${localId}`);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeTruthy();
  });

  it('is idempotent — deleting an already-archived CV succeeds again', async () => {
    const res = await request(app).delete(`/api/cvs/${localId}`);
    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).delete('/api/cvs/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a CV that was never created', async () => {
    const res = await request(app).delete('/api/cvs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cvs/:id — in use by an active job', () => {
  let cvId: string;
  let jobId: string;

  beforeAll(async () => {
    const cv = await request(app)
      .post('/api/cvs')
      .send({ label: 'In Use CV', data: {} });
    cvId = cv.body.id;

    const job = await request(app)
      .post('/api/jobs')
      .send({ company: 'Acme', title: 'QA Lead', descriptionRaw: 'desc', cvId });
    jobId = job.body.id;
  });

  afterAll(async () => {
    if (jobId) await request(app).delete(`/api/jobs/${jobId}`);
    if (cvId) await request(app).delete(`/api/cvs/${cvId}`);
  });

  it('returns 409 while the job referencing it is not archived', async () => {
    const res = await request(app).delete(`/api/cvs/${cvId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('cv_in_use');
  });

  it('succeeds once the referencing job is archived', async () => {
    await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'archived' });
    const res = await request(app).delete(`/api/cvs/${cvId}`);
    expect(res.status).toBe(200);
  });
});

// ── Job CRUD ──────────────────────────────────────────────────────────────────

describe('Jobs API', () => {
  let cvId: string;
  const jobIdsToClean: string[] = [];

  beforeAll(async () => {
    const cv = await request(app)
      .post('/api/cvs')
      .send({ label: 'Jobs Test CV', data: {} });
    cvId = cv.body.id;
  });

  afterAll(async () => {
    for (const id of jobIdsToClean) {
      await request(app).delete(`/api/jobs/${id}`);
    }
    if (cvId) await request(app).delete(`/api/cvs/${cvId}`);
  });

  describe('POST /api/jobs', () => {
    it('creates a job with default status and priority', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Acme', title: 'QA Lead', descriptionRaw: 'We need a QA lead...' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('lead');
      expect(res.body.priority).toBe(2);
      expect(res.body.submitted).toBe(false);
      expect(res.body.events).toEqual([]);
      jobIdsToClean.push(res.body.id);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/jobs').send({ company: 'Acme' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid status', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Acme', title: 'X', descriptionRaw: 'd', status: 'not-a-status' });
      expect(res.status).toBe(400);
    });

    it('returns 409 when status=applied is set without a cvId', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Acme', title: 'X', descriptionRaw: 'd', status: 'applied' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('cv_required_for_applied');
    });

    it('returns 400 when cvId does not refer to an existing CV', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Acme', title: 'X', descriptionRaw: 'd', cvId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(400);
    });

    it('sets appliedAt automatically when created directly as applied', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Acme', title: 'X', descriptionRaw: 'd', status: 'applied', cvId });
      expect(res.status).toBe(200);
      expect(res.body.appliedAt).toBeTruthy();
      jobIdsToClean.push(res.body.id);
    });
  });

  describe('GET /api/jobs', () => {
    let leadId: string;
    let interviewId: string;

    beforeAll(async () => {
      const a = await request(app)
        .post('/api/jobs')
        .send({ company: 'Filter Co', title: 'Backend Engineer', descriptionRaw: 'd', status: 'lead' });
      leadId = a.body.id;
      jobIdsToClean.push(leadId);

      const b = await request(app)
        .post('/api/jobs')
        .send({ company: 'Other Co', title: 'Frontend Engineer', descriptionRaw: 'd', status: 'lead' });
      await request(app).patch(`/api/jobs/${b.body.id}`).send({ status: 'to_apply' });
      await request(app).patch(`/api/jobs/${b.body.id}`).send({ cvId, status: 'applied' });
      await request(app).patch(`/api/jobs/${b.body.id}`).send({ status: 'interview' });
      interviewId = b.body.id;
      jobIdsToClean.push(interviewId);
    });

    it('returns an array of jobs', async () => {
      const res = await request(app).get('/api/jobs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters by status', async () => {
      const res = await request(app).get('/api/jobs?status=interview');
      expect(res.body.every((j: { status: string }) => j.status === 'interview')).toBe(true);
      expect(res.body.some((j: { id: string }) => j.id === interviewId)).toBe(true);
      expect(res.body.some((j: { id: string }) => j.id === leadId)).toBe(false);
    });

    it('filters by free-text query on company/title', async () => {
      const res = await request(app).get('/api/jobs?q=Filter');
      expect(res.body.some((j: { id: string }) => j.id === leadId)).toBe(true);
      expect(res.body.some((j: { id: string }) => j.id === interviewId)).toBe(false);
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('returns 404 for an unknown job', async () => {
      const res = await request(app).get('/api/jobs/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/jobs/:id', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Patch Co', title: 'Dev', descriptionRaw: 'd' });
      jobId = res.body.id;
      jobIdsToClean.push(jobId);
    });

    it('updates simple fields', async () => {
      const res = await request(app).patch(`/api/jobs/${jobId}`).send({ priority: 1, notes: 'Interesting' });
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe(1);
      expect(res.body.notes).toBe('Interesting');
    });

    it('appends a status_change event when status changes', async () => {
      const res = await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'to_apply' });
      expect(res.status).toBe(200);
      const event = res.body.events.at(-1);
      expect(event.type).toBe('status_change');
      expect(event.from).toBe('lead');
      expect(event.to).toBe('to_apply');
    });

    it('returns 409 when moving to applied without a cvId', async () => {
      const res = await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'applied' });
      expect(res.status).toBe(409);
    });

    it('allows moving to applied when cvId is provided in the same request', async () => {
      const res = await request(app).patch(`/api/jobs/${jobId}`).send({ status: 'applied', cvId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('applied');
      expect(res.body.appliedAt).toBeTruthy();
    });

    it('appends a match_submitted event when submitted flips to true', async () => {
      const res = await request(app).patch(`/api/jobs/${jobId}`).send({ submitted: true });
      expect(res.status).toBe(200);
      expect(res.body.submittedAt).toBeTruthy();
      expect(res.body.events.some((e: { type: string }) => e.type === 'match_submitted')).toBe(true);
    });

    it('returns 404 for an unknown job', async () => {
      const res = await request(app)
        .patch('/api/jobs/00000000-0000-0000-0000-000000000000')
        .send({ notes: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/jobs/:id', () => {
    it('deletes the job and returns success', async () => {
      const created = await request(app)
        .post('/api/jobs')
        .send({ company: 'Delete Co', title: 'X', descriptionRaw: 'd' });
      const res = await request(app).delete(`/api/jobs/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('returns 404 after the job has been deleted', async () => {
      const created = await request(app)
        .post('/api/jobs')
        .send({ company: 'Delete Co 2', title: 'X', descriptionRaw: 'd' });
      await request(app).delete(`/api/jobs/${created.body.id}`);
      const res = await request(app).delete(`/api/jobs/${created.body.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/jobs/:id/events', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Events Co', title: 'Dev', descriptionRaw: 'd' });
      jobId = res.body.id;
      jobIdsToClean.push(jobId);
    });

    it('appends a note event', async () => {
      const res = await request(app)
        .post(`/api/jobs/${jobId}/events`)
        .send({ type: 'note', comment: 'Called the recruiter' });
      expect(res.status).toBe(200);
      expect(res.body.events.at(-1)).toMatchObject({ type: 'note', comment: 'Called the recruiter' });
    });

    it('returns 400 for an invalid event type', async () => {
      const res = await request(app).post(`/api/jobs/${jobId}/events`).send({ type: 'bogus' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/jobs/:id/score', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Score Co', title: 'Dev', descriptionRaw: 'Looking for a React developer' });
      jobId = res.body.id;
      jobIdsToClean.push(jobId);
    });

    const fakeAts = {
      score: 78,
      breakdown: { keywords: 80, hardSkills: 70, experience: 75, formatting: 90 },
      matchedKeywords: ['React'],
      missingKeywords: ['GraphQL'],
      suggestions: ['Add GraphQL experience'],
      provider: 'fake' as const,
      model: 'fake-v1',
      promptVersion: 'ats-v1',
      jobDescriptionHash: 'client-supplied-should-be-overwritten',
    };

    it('persists the score onto the job and recomputes jobDescriptionHash server-side', async () => {
      const res = await request(app)
        .post(`/api/jobs/${jobId}/score`)
        .send({ cvId, cvContentHash: 'abc123', ats: fakeAts });
      expect(res.status).toBe(200);
      expect(res.body.cvId).toBe(cvId);
      expect(res.body.cvContentHash).toBe('abc123');
      expect(res.body.ats.score).toBe(78);
      expect(res.body.ats.jobDescriptionHash).not.toBe('client-supplied-should-be-overwritten');
      expect(res.body.atsComputedAt).toBeTruthy();
    });

    it('returns 400 when cvId does not exist', async () => {
      const res = await request(app)
        .post(`/api/jobs/${jobId}/score`)
        .send({ cvId: '00000000-0000-0000-0000-000000000000', cvContentHash: 'x', ats: fakeAts });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown job', async () => {
      const res = await request(app)
        .post('/api/jobs/00000000-0000-0000-0000-000000000000/score')
        .send({ cvId, cvContentHash: 'x', ats: fakeAts });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/jobs/:id/generate-application-text', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ company: 'Pitch Co', title: 'Dev', descriptionRaw: 'Looking for a React developer' });
      jobId = res.body.id;
      jobIdsToClean.push(jobId);
    });

    // NODE_ENV=test (set by vitest) makes routes.jobs.js's useFakeAi() true, so this
    // hits server/scrapers/fake.js's generateApplicationText — no real CLI call.
    it('returns generated text for each valid textType', async () => {
      for (const textType of ['quick_pitch', 'full_pitch', 'referral_message']) {
        const res = await request(app)
          .post(`/api/jobs/${jobId}/generate-application-text`)
          .send({ textType, cvText: 'EXPERIENCE\n- Built a React app used by 10k users' });
        expect(res.status).toBe(200);
        expect(typeof res.body.text).toBe('string');
        expect(res.body.text.length).toBeGreaterThan(0);
      }
    });

    it('returns 400 for an invalid textType', async () => {
      const res = await request(app)
        .post(`/api/jobs/${jobId}/generate-application-text`)
        .send({ textType: 'not_a_real_type', cvText: 'some cv text' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when cvText is missing or empty', async () => {
      const res = await request(app)
        .post(`/api/jobs/${jobId}/generate-application-text`)
        .send({ textType: 'quick_pitch', cvText: '' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown job', async () => {
      const res = await request(app)
        .post('/api/jobs/00000000-0000-0000-0000-000000000000/generate-application-text')
        .send({ textType: 'quick_pitch', cvText: 'some cv text' });
      expect(res.status).toBe(404);
    });
  });
});
