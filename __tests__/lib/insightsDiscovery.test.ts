import { describe, it, expect } from 'vitest';
import {
  fitDistribution,
  reviewConversion,
  portalYield,
  geographyBreakdown,
  shouldNudgeRemoteMismatch,
} from '../../lib/insightsDiscovery';
import { ScrapedJob } from '../../types';

type C = Pick<ScrapedJob, 'id' | 'fit' | 'score' | 'status' | 'portal' | 'department' | 'isRemote'>;

function candidate(overrides: Partial<C> & { id: string }): C {
  return {
    fit: undefined,
    score: undefined,
    status: 'new',
    portal: 'france_travail',
    department: undefined,
    isRemote: false,
    ...overrides,
  };
}

describe('fitDistribution', () => {
  it('buckets candidates by fit and groups score-less candidates as unqualified', () => {
    const dist = fitDistribution([
      candidate({ id: '1', fit: 'high', score: 90 }),
      candidate({ id: '2', fit: 'medium', score: 60 }),
      candidate({ id: '3', fit: 'low', score: 20 }),
      candidate({ id: '4' }), // no score/fit at all
      candidate({ id: '5', fit: 'high' }), // fit set but score missing — still unqualified
    ]);
    expect(dist).toEqual({ high: 1, medium: 1, low: 1, unqualified: 2, total: 5 });
  });
});

describe('reviewConversion', () => {
  it('returns no importRate below the minimum reviewed threshold', () => {
    const result = reviewConversion(
      [
        candidate({ id: '1', fit: 'high', status: 'imported' }),
        candidate({ id: '2', fit: 'high', status: 'dismissed' }),
      ],
      'high'
    );
    expect(result.importRate).toBeUndefined();
    expect(result.reviewedCount).toBe(2);
  });

  it('computes the import rate among reviewed candidates once above the threshold', () => {
    const candidates: C[] = [
      ...Array.from({ length: 3 }, (_, i) => candidate({ id: `imp-${i}`, fit: 'high', status: 'imported' as const })),
      ...Array.from({ length: 2 }, (_, i) => candidate({ id: `dis-${i}`, fit: 'high', status: 'dismissed' as const })),
    ];
    const result = reviewConversion(candidates, 'high');
    expect(result.reviewedCount).toBe(5);
    expect(result.importRate).toBe(0.6);
  });

  it('excludes un-reviewed ("new") candidates from both numerator and denominator', () => {
    const candidates: C[] = [
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `imp-${i}`, fit: 'high', status: 'imported' as const })),
      ...Array.from({ length: 10 }, (_, i) => candidate({ id: `new-${i}`, fit: 'high', status: 'new' as const })),
    ];
    const result = reviewConversion(candidates, 'high');
    expect(result.reviewedCount).toBe(5);
    expect(result.importRate).toBe(1);
  });

  it('is scoped to the requested tier only', () => {
    const candidates: C[] = [
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `high-${i}`, fit: 'high', status: 'imported' as const })),
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `med-${i}`, fit: 'medium', status: 'dismissed' as const })),
    ];
    const high = reviewConversion(candidates, 'high');
    expect(high.importRate).toBe(1);
    const medium = reviewConversion(candidates, 'medium');
    expect(medium.importRate).toBe(0);
  });
});

describe('portalYield', () => {
  it('excludes a portal below the minimum qualified count from the ranking', () => {
    const candidates: C[] = Array.from({ length: 3 }, (_, i) => candidate({ id: `p-${i}`, portal: 'freehire', score: 80, fit: 'high' }));
    const { ranked, insufficient } = portalYield(candidates);
    expect(ranked).toEqual([]);
    expect(insufficient).toEqual([{ portal: 'freehire', qualified: 3 }]);
  });

  it('ranks portals at or above the threshold by highRate, tie-broken by medianScore', () => {
    const a = Array.from({ length: 10 }, (_, i) => candidate({ id: `a-${i}`, portal: 'a', score: 80, fit: i < 5 ? 'high' : 'medium' }));
    const b = Array.from({ length: 10 }, (_, i) => candidate({ id: `b-${i}`, portal: 'b', score: 60, fit: i < 8 ? 'high' : 'medium' }));
    const { ranked, insufficient } = portalYield([...a, ...b]);
    expect(insufficient).toEqual([]);
    expect(ranked.map((r) => r.portal)).toEqual(['b', 'a']);
    expect(ranked[0].highRate).toBe(0.8);
    expect(ranked[1].highRate).toBe(0.5);
  });

  it('excludes unqualified candidates entirely from portal counts', () => {
    const candidates: C[] = [
      ...Array.from({ length: 10 }, (_, i) => candidate({ id: `q-${i}`, portal: 'a', score: 80, fit: 'high' })),
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `uq-${i}`, portal: 'a' })), // no score
    ];
    const { ranked } = portalYield(candidates);
    expect(ranked[0].qualified).toBe(10);
  });
});

describe('geographyBreakdown', () => {
  it('reports insufficient when fewer than the minimum high-fit candidates exist', () => {
    const candidates: C[] = Array.from({ length: 3 }, (_, i) => candidate({ id: `h-${i}`, fit: 'high', department: '92' }));
    const result = geographyBreakdown(candidates);
    expect(result.sufficient).toBe(false);
    expect(result.highCount).toBe(3);
  });

  it('tallies departments among high-fit candidates only, with an unknown bucket', () => {
    const candidates: C[] = [
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `92-${i}`, fit: 'high', department: '92' })),
      ...Array.from({ length: 3 }, (_, i) => candidate({ id: `unk-${i}`, fit: 'high', department: undefined })),
      candidate({ id: 'medium-1', fit: 'medium', department: '92' }), // excluded — not high fit
    ];
    const result = geographyBreakdown(candidates);
    expect(result.sufficient).toBe(true);
    expect(result.highCount).toBe(8);
    expect(result.departments).toEqual([
      { department: '92', count: 5 },
      { department: 'unknown', count: 3 },
    ]);
  });

  it('computes remoteShare among high-fit candidates only', () => {
    const candidates: C[] = [
      ...Array.from({ length: 4 }, (_, i) => candidate({ id: `r-${i}`, fit: 'high', isRemote: true })),
      ...Array.from({ length: 4 }, (_, i) => candidate({ id: `o-${i}`, fit: 'high', isRemote: false })),
    ];
    const result = geographyBreakdown(candidates);
    expect(result.remoteShare).toBe(0.5);
  });
});

describe('shouldNudgeRemoteMismatch', () => {
  it('fires when remote share is high and remote is not an accepted work mode', () => {
    expect(shouldNudgeRemoteMismatch(0.5, ['onsite'])).toBe(true);
  });

  it('does not fire when remote is already an accepted work mode', () => {
    expect(shouldNudgeRemoteMismatch(0.9, ['remote'])).toBe(false);
  });

  it('does not fire when remote share is below the threshold', () => {
    expect(shouldNudgeRemoteMismatch(0.3, ['onsite'])).toBe(false);
  });

  it('does not fire when remoteShare is undefined (insufficient data)', () => {
    expect(shouldNudgeRemoteMismatch(undefined, ['onsite'])).toBe(false);
  });
});
