// Single source of truth for score→fit bucketing, shared by claudeCli.js (real LLM)
// and fake.js (deterministic test double) so both code paths always agree on tier
// boundaries — the client never re-derives fit from score itself (see types.ts
// ScrapedJob.fit / .score).
export const FIT_HIGH_THRESHOLD = 75;
export const FIT_MEDIUM_THRESHOLD = 45;

// `mediumThreshold` overrides FIT_MEDIUM_THRESHOLD (the auto-dismiss boundary — a
// candidate below it becomes 'low' and gets auto-dismissed downstream) with the
// user's own SearchPreferences.autoDismissBelowScore when they've set one; every
// caller that doesn't pass one keeps today's fixed 45.
/** @param {number} score @param {number} [mediumThreshold] @returns {'high'|'medium'|'low'} */
export function fitFromScore(score, mediumThreshold = FIT_MEDIUM_THRESHOLD) {
    if (score >= FIT_HIGH_THRESHOLD) return 'high';
    if (score >= mediumThreshold) return 'medium';
    return 'low';
}
