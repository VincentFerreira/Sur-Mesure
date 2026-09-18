import { Job, JobStatus } from '../types';
import { median } from './insightsFormat';

// 'rejected'/'archived' are terminal side-exits, not pipeline stages a job progresses
// through in order — they're handled separately (see rejectedExits/archivedCount).
export const PIPELINE_STAGES = ['lead', 'to_apply', 'applied', 'screening', 'interview', 'offer'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const MIN_FUNNEL_N = 5;
const MIN_DURATION_N = 3;
const MS_PER_DAY = 86_400_000;
const PIPELINE_STAGE_IDS: readonly string[] = PIPELINE_STAGES;

function stageIndex(status: JobStatus | undefined): number {
  if (!status) return -1;
  return PIPELINE_STAGE_IDS.indexOf(status); // -1 for 'rejected'/'archived'
}

type FunnelJob = Pick<Job, 'status' | 'events' | 'appliedAt' | 'createdAt'>;

// The furthest pipeline stage a job has genuinely reached, floored at 0 (lead) — every
// known job was at least a lead. Combines three evidence sources because none alone is
// reliable:
// - `status` alone would erase history on a rejection/archive (a job rejected right
//   after an interview must still count as having reached 'interview').
// - events alone miss jobs created/imported directly at an advanced status: the server
//   only appends a status_change event on PATCH /api/jobs/:id (server/routes.jobs.js).
// - `appliedAt` alone misses stages reached after applying.
// The `from` leg of each status_change event is the critical rule that makes rejections
// not erase history — without it, an interview -> rejected transition would count only
// 'rejected' (which isn't even a pipeline stage), losing the interview entirely.
export function reachedIndex(job: FunnelJob): number {
  let max = stageIndex(job.status);
  for (const e of job.events) {
    if (e.type !== 'status_change') continue;
    max = Math.max(max, stageIndex(e.to), stageIndex(e.from));
  }
  if (job.appliedAt) max = Math.max(max, stageIndex('applied'));
  return Math.max(max, 0);
}

function entryTimesByStage(job: FunnelJob): Partial<Record<PipelineStage, string>> {
  const atStage: Partial<Record<PipelineStage, string>> = { lead: job.createdAt };
  for (const e of job.events) {
    if (e.type !== 'status_change' || !e.to || !PIPELINE_STAGE_IDS.includes(e.to)) continue;
    const stage = e.to as PipelineStage;
    // Earliest event wins — a job can re-enter the same stage more than once.
    const existing = atStage[stage];
    if (!existing || e.at < existing) atStage[stage] = e.at;
  }
  return atStage;
}

export interface StageMetrics {
  stage: PipelineStage;
  reachedCount: number;
  conversionToNext?: number; // undefined for the last stage, or below MIN_FUNNEL_N
  medianDurationDays?: number; // undefined below MIN_DURATION_N completed transitions
  completedDurationCount: number;
  inProgressCount: number;
  oldestInProgressDays?: number;
}

export interface ExitTally {
  stage: PipelineStage;
  count: number;
}

export interface FunnelResult {
  stages: StageMetrics[];
  rejectedExits: ExitTally[];
  archivedCount: number;
}

export function computeFunnel(jobs: FunnelJob[], now: Date = new Date()): FunnelResult {
  const reached = PIPELINE_STAGES.map((_, i) => jobs.filter((j) => reachedIndex(j) >= i).length);

  const stages: StageMetrics[] = PIPELINE_STAGES.map((stage, i) => {
    const durations: number[] = [];
    let inProgressCount = 0;
    let oldestInProgressMs = 0;

    for (const job of jobs) {
      if (reachedIndex(job) < i) continue; // never reached this stage at all
      const atStage = entryTimesByStage(job);
      const enteredAt = atStage[stage];
      if (!enteredAt) continue; // reached it (via the from-leg/appliedAt) but no timestamp evidence for it

      const enteredMs = new Date(enteredAt).getTime();
      let nextMs: number | undefined;
      for (let j = i + 1; j < PIPELINE_STAGES.length; j++) {
        const laterAt = atStage[PIPELINE_STAGES[j]];
        if (!laterAt) continue;
        const laterMs = new Date(laterAt).getTime();
        if (nextMs === undefined || laterMs < nextMs) nextMs = laterMs;
      }

      if (nextMs !== undefined) {
        durations.push((nextMs - enteredMs) / MS_PER_DAY);
      } else if (stageIndex(job.status) === i) {
        // Only "in progress" at this stage if the job is CURRENTLY sitting there — a
        // job that exited sideways (rejected/archived) after this stage without ever
        // recording entry into a later pipeline stage is neither in-progress nor
        // measurable here (see FunnelResult.rejectedExits for that case instead).
        inProgressCount += 1;
        oldestInProgressMs = Math.max(oldestInProgressMs, now.getTime() - enteredMs);
      }
    }

    const reachedCount = reached[i];
    const nextReachedCount = i + 1 < PIPELINE_STAGES.length ? reached[i + 1] : undefined;

    return {
      stage,
      reachedCount,
      conversionToNext: nextReachedCount !== undefined && reachedCount >= MIN_FUNNEL_N ? nextReachedCount / reachedCount : undefined,
      medianDurationDays: durations.length >= MIN_DURATION_N ? median(durations) : undefined,
      completedDurationCount: durations.length,
      inProgressCount,
      oldestInProgressDays: inProgressCount > 0 ? oldestInProgressMs / MS_PER_DAY : undefined,
    };
  });

  const rejectedExitCounts = new Map<PipelineStage, number>();
  let archivedCount = 0;
  for (const job of jobs) {
    if (job.status === 'archived') archivedCount += 1;
    if (job.status !== 'rejected') continue;
    const stage = PIPELINE_STAGES[reachedIndex(job)];
    rejectedExitCounts.set(stage, (rejectedExitCounts.get(stage) ?? 0) + 1);
  }
  const rejectedExits = PIPELINE_STAGES.filter((s) => rejectedExitCounts.has(s)).map((stage) => ({
    stage,
    count: rejectedExitCounts.get(stage) as number,
  }));

  return { stages, rejectedExits, archivedCount };
}

export const FUNNEL_THRESHOLDS = { MIN_FUNNEL_N, MIN_DURATION_N };
