import { ScrapedJob, JobWorkMode } from '../types';
import { median } from './insightsFormat';

const MIN_REVIEWED = 5;
const MIN_PORTAL_N = 10;
const MIN_GEO_N = 8;
const REMOTE_MISMATCH_SHARE_THRESHOLD = 0.4;
const UNKNOWN_DEPARTMENT = 'unknown';
const TOP_DEPARTMENTS = 6;

type DiscoveryCandidate = Pick<ScrapedJob, 'id' | 'fit' | 'score' | 'status' | 'portal' | 'department' | 'isRemote'>;

export interface FitDistribution {
  high: number;
  medium: number;
  low: number;
  unqualified: number;
  total: number;
}

// Never silently drops or averages unqualified candidates as a score of 0 — they get
// their own explicit bucket so the page can say "217 not qualified" rather than pretend
// they don't exist or count them as a failing score.
export function fitDistribution(candidates: DiscoveryCandidate[]): FitDistribution {
  const dist: FitDistribution = { high: 0, medium: 0, low: 0, unqualified: 0, total: candidates.length };
  for (const c of candidates) {
    if (c.fit && c.score !== undefined) dist[c.fit] += 1;
    else dist.unqualified += 1;
  }
  return dist;
}

export interface ReviewConversion {
  tier: 'high' | 'medium';
  reviewedCount: number;
  importRate?: number; // undefined when reviewedCount < MIN_REVIEWED
}

// Import rate among *reviewed* (status !== 'new') candidates of one tier — restricted
// to high/medium only. 'low' is deliberately excluded: it auto-dismisses server-side
// (see server/scrapers/claudeCli.js / fake.js), so its "review conversion" would be
// ~100% dismissed by construction, not a human judgment. A candidate still sitting in
// 'new' is neither converted nor rejected — it just hasn't been reviewed yet — so it's
// excluded from both the numerator and the denominator, not treated as a rejection.
export function reviewConversion(candidates: DiscoveryCandidate[], tier: 'high' | 'medium'): ReviewConversion {
  const reviewed = candidates.filter((c) => c.fit === tier && c.status !== 'new');
  const reviewedCount = reviewed.length;
  if (reviewedCount < MIN_REVIEWED) return { tier, reviewedCount };
  const imported = reviewed.filter((c) => c.status === 'imported').length;
  return { tier, reviewedCount, importRate: imported / reviewedCount };
}

export interface PortalYield {
  portal: string;
  qualified: number;
  highCount: number;
  highRate: number;
  medianScore: number;
}

export interface PortalInsufficient {
  portal: string;
  qualified: number;
}

export interface PortalYieldResult {
  ranked: PortalYield[];
  insufficient: PortalInsufficient[];
}

// Per-portal yield among qualified candidates only. A portal under MIN_PORTAL_N drops
// out of the ranking entirely (a "100% Fort" from 1 candidate is not a finding) and
// moves to `insufficient` instead, so the ranking never mixes reliable and
// single-sample rows.
export function portalYield(candidates: DiscoveryCandidate[]): PortalYieldResult {
  const byPortal = new Map<string, DiscoveryCandidate[]>();
  for (const c of candidates) {
    if (c.score === undefined) continue;
    const list = byPortal.get(c.portal) ?? [];
    list.push(c);
    byPortal.set(c.portal, list);
  }

  const ranked: PortalYield[] = [];
  const insufficient: PortalInsufficient[] = [];

  for (const [portal, list] of byPortal) {
    if (list.length < MIN_PORTAL_N) {
      insufficient.push({ portal, qualified: list.length });
      continue;
    }
    const highCount = list.filter((c) => c.fit === 'high').length;
    ranked.push({
      portal,
      qualified: list.length,
      highCount,
      highRate: highCount / list.length,
      medianScore: median(list.map((c) => c.score as number)) as number,
    });
  }

  ranked.sort((a, b) => b.highRate - a.highRate || b.medianScore - a.medianScore || a.portal.localeCompare(b.portal));
  insufficient.sort((a, b) => a.portal.localeCompare(b.portal));

  return { ranked, insufficient };
}

export interface DepartmentTally {
  department: string; // a department code, or UNKNOWN_DEPARTMENT
  count: number;
}

export interface GeographyResult {
  sufficient: boolean;
  highCount: number;
  departments: DepartmentTally[];
  remoteShare?: number; // undefined when insufficient
}

// Restricted to fit === 'high' candidates only — the question this answers is "where
// are the GOOD offers", not "where are offers in general".
export function geographyBreakdown(candidates: DiscoveryCandidate[]): GeographyResult {
  const high = candidates.filter((c) => c.fit === 'high');
  if (high.length < MIN_GEO_N) {
    return { sufficient: false, highCount: high.length, departments: [] };
  }

  const counts = new Map<string, number>();
  for (const c of high) {
    const key = c.department ?? UNKNOWN_DEPARTMENT;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const departments = [...counts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department))
    .slice(0, TOP_DEPARTMENTS);

  const remoteCount = high.filter((c) => c.isRemote).length;

  return { sufficient: true, highCount: high.length, departments, remoteShare: remoteCount / high.length };
}

// Fires only when there's a real, sizeable mismatch — not on any nonzero difference.
export function shouldNudgeRemoteMismatch(remoteShare: number | undefined, workModes: JobWorkMode[]): boolean {
  return remoteShare !== undefined && remoteShare > REMOTE_MISMATCH_SHARE_THRESHOLD && !workModes.includes('remote');
}

export const DISCOVERY_THRESHOLDS = { MIN_REVIEWED, MIN_PORTAL_N, MIN_GEO_N, REMOTE_MISMATCH_SHARE_THRESHOLD };
