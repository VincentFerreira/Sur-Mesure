// Single source of truth for score→fit bucketing, shared by claudeCli.js (real LLM)
// and fake.js (deterministic test double) so both code paths always agree on tier
// boundaries — the client never re-derives fit from score itself (see types.ts
// ScrapedJob.fit / .score).
export const FIT_HIGH_THRESHOLD = 75;
export const FIT_MEDIUM_THRESHOLD = 45;

/** @param {number} score @returns {'high'|'medium'|'low'} */
export function fitFromScore(score) {
    if (score >= FIT_HIGH_THRESHOLD) return 'high';
    if (score >= FIT_MEDIUM_THRESHOLD) return 'medium';
    return 'low';
}
