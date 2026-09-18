import { describe, it, expect } from 'vitest';
import { reachedIndex, computeFunnel, PIPELINE_STAGES } from '../../lib/insightsFunnel';
import { Job, JobEvent, JobStatus } from '../../types';

let eventCounter = 0;
function event(overrides: Partial<JobEvent> & { type: JobEvent['type'] }): JobEvent {
  eventCounter += 1;
  return { id: `e${eventCounter}`, at: '2026-01-01T00:00:00.000Z', ...overrides };
}

function job(overrides: Partial<Job> & { id: string; status: JobStatus }): Job {
  return {
    company: 'Acme',
    title: 'QA',
    priority: 2,
    descriptionRaw: '',
    keywords: [],
    submitted: false,
    events: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('reachedIndex', () => {
  it('a job at interview with zero events counts as having reached interview', () => {
    expect(reachedIndex(job({ id: '1', status: 'interview' }))).toBe(PIPELINE_STAGES.indexOf('interview'));
  });

  it('a rejected job with a from:interview event still counts interview as reached (the from-leg rule)', () => {
    const j = job({
      id: '1',
      status: 'rejected',
      events: [event({ type: 'status_change', from: 'interview', to: 'rejected' })],
    });
    expect(reachedIndex(j)).toBe(PIPELINE_STAGES.indexOf('interview'));
  });

  it('a rejected job with no events at all floors at 0 (lead)', () => {
    expect(reachedIndex(job({ id: '1', status: 'rejected' }))).toBe(0);
  });

  it('an archived job with appliedAt set and no events reaches at least "applied"', () => {
    const j = job({ id: '1', status: 'archived', appliedAt: '2026-01-05T00:00:00.000Z' });
    expect(reachedIndex(j)).toBe(PIPELINE_STAGES.indexOf('applied'));
  });

  it('a job currently at lead with no events reaches only lead', () => {
    expect(reachedIndex(job({ id: '1', status: 'lead' }))).toBe(0);
  });
});

describe('computeFunnel — reached counts', () => {
  it('is monotonically non-increasing across stages', () => {
    const jobs = [
      job({ id: '1', status: 'lead' }),
      job({ id: '2', status: 'applied' }),
      job({ id: '3', status: 'interview' }),
      job({ id: '4', status: 'offer' }),
    ];
    const { stages } = computeFunnel(jobs);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].reachedCount).toBeLessThanOrEqual(stages[i - 1].reachedCount);
    }
    expect(stages[0].reachedCount).toBe(4); // all 4 reached at least lead
    expect(stages[PIPELINE_STAGES.indexOf('offer')].reachedCount).toBe(1);
  });

  it('does not report a conversion rate below the minimum-N guard', () => {
    const jobs = [job({ id: '1', status: 'applied' }), job({ id: '2', status: 'lead' })];
    const { stages } = computeFunnel(jobs);
    expect(stages[0].conversionToNext).toBeUndefined(); // only 2 reached lead, below MIN_FUNNEL_N=5
  });

  it('reports a conversion rate once at or above the minimum-N guard', () => {
    const jobs = [
      ...Array.from({ length: 4 }, (_, i) => job({ id: `applied-${i}`, status: 'applied' as const })),
      job({ id: 'lead-1', status: 'lead' as const }),
    ];
    const { stages } = computeFunnel(jobs);
    expect(stages[0].reachedCount).toBe(5);
    expect(stages[0].conversionToNext).toBe(4 / 5);
  });

  it('has no conversionToNext for the last stage', () => {
    const jobs = [job({ id: '1', status: 'offer' })];
    const { stages } = computeFunnel(jobs);
    expect(stages[PIPELINE_STAGES.length - 1].conversionToNext).toBeUndefined();
  });
});

describe('computeFunnel — durations', () => {
  it('computes the duration of a stage from entry to the next recorded stage entry', () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      job({
        id: `j${i}`,
        status: 'applied',
        createdAt: '2026-01-01T00:00:00.000Z',
        events: [event({ type: 'status_change', from: 'lead', to: 'applied', at: '2026-01-06T00:00:00.000Z' })],
      })
    );
    const { stages } = computeFunnel(jobs);
    const lead = stages[PIPELINE_STAGES.indexOf('lead')];
    expect(lead.medianDurationDays).toBe(5);
    expect(lead.completedDurationCount).toBe(3);
  });

  it('handles a skipped stage: lead -> applied directly still yields lead duration via applied entry', () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      job({
        id: `j${i}`,
        status: 'applied',
        createdAt: '2026-01-01T00:00:00.000Z',
        // No 'to_apply' event at all.
        events: [event({ type: 'status_change', from: 'lead', to: 'applied', at: '2026-01-04T00:00:00.000Z' })],
      })
    );
    const { stages } = computeFunnel(jobs);
    expect(stages[PIPELINE_STAGES.indexOf('lead')].medianDurationDays).toBe(3);
    // to_apply was never actually entered by any of these jobs — no duration data for it.
    expect(stages[PIPELINE_STAGES.indexOf('to_apply')].completedDurationCount).toBe(0);
  });

  it('excludes a job still sitting in a stage from the median but reports it as in-progress', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) =>
        job({
          id: `done-${i}`,
          status: 'interview',
          events: [
            event({ type: 'status_change', from: 'lead', to: 'applied', at: '2026-01-02T00:00:00.000Z' }),
            event({ type: 'status_change', from: 'applied', to: 'interview', at: '2026-01-05T00:00:00.000Z' }),
          ],
        })
      ),
      job({
        id: 'stuck',
        status: 'applied',
        events: [event({ type: 'status_change', from: 'lead', to: 'applied', at: '2026-01-03T00:00:00.000Z' })],
      }),
    ];
    const { stages } = computeFunnel(jobs, now);
    const applied = stages[PIPELINE_STAGES.indexOf('applied')];
    expect(applied.completedDurationCount).toBe(3); // the 3 that moved on to interview
    expect(applied.inProgressCount).toBe(1); // the stuck one
    expect(applied.oldestInProgressDays).toBe(7); // Jan 10 - Jan 3
  });

  it('does not report a median below the minimum completed-transition count', () => {
    const jobs = Array.from({ length: 2 }, (_, i) =>
      job({
        id: `j${i}`,
        status: 'applied',
        events: [event({ type: 'status_change', from: 'lead', to: 'applied', at: '2026-01-03T00:00:00.000Z' })],
      })
    );
    const { stages } = computeFunnel(jobs);
    expect(stages[PIPELINE_STAGES.indexOf('lead')].medianDurationDays).toBeUndefined();
  });
});

describe('computeFunnel — exits', () => {
  it('groups rejected jobs by the furthest stage they actually reached', () => {
    const jobs = [
      job({ id: '1', status: 'rejected', events: [event({ type: 'status_change', from: 'interview', to: 'rejected' })] }),
      job({ id: '2', status: 'rejected', events: [event({ type: 'status_change', from: 'applied', to: 'rejected' })] }),
      job({ id: '3', status: 'rejected' }), // no events -> lead
    ];
    const { rejectedExits } = computeFunnel(jobs);
    expect(rejectedExits).toEqual([
      { stage: 'lead', count: 1 },
      { stage: 'applied', count: 1 },
      { stage: 'interview', count: 1 },
    ]);
  });

  it('counts archived jobs separately from rejected exits', () => {
    const jobs = [job({ id: '1', status: 'archived' }), job({ id: '2', status: 'lead' })];
    const { archivedCount, rejectedExits } = computeFunnel(jobs);
    expect(archivedCount).toBe(1);
    expect(rejectedExits).toEqual([]);
  });
});
