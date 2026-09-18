// Deterministic, no-network portal used by tests and e2e — same role as the `fake`
// AI provider in aiService.ts / VITE_ATS_PROVIDER=fake. Never hits a real API, so tests
// don't depend on France Travail credentials or network access. Returns results that
// reference `query`/`location` so a test can assert the search parameters were passed
// through correctly.
import { fitFromScore } from './scraperFit.js';

export const id = 'fake';

export async function search({ query, location }) {
    return [
        {
            title: query || 'Fake Job Title',
            company: 'Fake Company',
            location: location || 'Remote',
            url: `https://example.test/jobs/fake-${encodeURIComponent(query ?? 'job')}`,
            postedDate: new Date().toISOString().slice(0, 10),
            descriptionRaw: `Fake posting matching "${query}" in "${location}".`,
        },
    ];
}

// Deterministic stand-ins for claudeCli.js's expandKeywords/qualifyAll — same role as
// the rest of this module: no CLI subprocess spawned, so tests never depend on the
// `claude` binary being installed/authenticated. Ported directly from aiService.ts's
// former qualifyFake/significantWords/locationMatches (now removed there — see
// server/routes.scraper.js, which is the only caller of these two).
export async function expandKeywords(jobTitles) {
    return jobTitles;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'is', 'are', 'we', 'you', 'your', 'our', 'this', 'that', 'be', 'as', 'at']);

function significantWords(text) {
    return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

function locationMatches(candidateLocation, targetLocations) {
    if (targetLocations.length === 0 || !candidateLocation) return true;
    const loc = candidateLocation.toLowerCase();
    return targetLocations.some((t) => {
        const target = t.toLowerCase();
        if (target.includes('remote') && loc.includes('remote')) return true;
        return loc.includes(target) || target.includes(loc);
    });
}

// Deterministic, keyword-based work-mode classifier — a much cruder stand-in for the
// nuanced free-text judgment claudeCli.js's real prompt makes. Only returns a mode when
// the text gives an explicit, unambiguous signal; returns undefined (never penalized)
// when the arrangement can't be determined from the text, same "don't guess from
// silence" principle as the real prompt.
const HYBRID_PATTERN = /hybrid|hybride/i;
const NEGATED_REMOTE_PATTERN = /(pas|aucun|sans)\s+(de\s+)?(t[ée]l[ée]travail|remote)/i;
const ONSITE_PATTERN = /sur site|pr[ée]sentiel|on-?site/i;
const REMOTE_PATTERN = /remote|t[ée]l[ée]travail/i;

function detectWorkMode(candidate) {
    const text = `${candidate.location ?? ''} ${candidate.descriptionRaw ?? ''}`;
    const hasHybrid = HYBRID_PATTERN.test(text);
    const hasNegatedRemote = NEGATED_REMOTE_PATTERN.test(text);
    const hasOnsite = ONSITE_PATTERN.test(text);
    const hasRemote = REMOTE_PATTERN.test(text) && !hasNegatedRemote;

    if (hasHybrid || (hasOnsite && hasRemote)) return 'hybrid';
    if (hasNegatedRemote || hasOnsite) return 'onsite';
    if (hasRemote) return 'remote';
    return undefined;
}

function workModeMatches(detectedWorkMode, targetWorkModes) {
    if (targetWorkModes.length === 0 || !detectedWorkMode) return true;
    return targetWorkModes.includes(detectedWorkMode);
}

const WORK_MODE_LABELS = { onsite: 'Onsite', hybrid: 'Hybrid', remote: 'Remote' };

// Base scores per bucket, spaced well inside each threshold band (see
// server/scrapers/scraperFit.js) so a one-level downgrade below always lands in the
// intended neighboring bucket: high=90, medium=60, low=20.
const BASE_SCORE = { high: 90, medium: 60, low: 20 };
const DOWNGRADE_STEP = 30;
const MAX_SIGNALS = 4;

// Deterministic stand-in for claudeCli.js's rejection-memory scoring: a real prompt
// judges semantic overlap between a candidate and a past rejection's stated reason,
// which a fake heuristic can't approximate — so this only downgrades an exact company
// match (case-insensitive), just enough to make the wiring (does the memory reach this
// function and change a score at all) testable without a real AI call.
function rejectedSameCompany(candidate, rejectionMemory) {
    const company = (candidate.company ?? '').trim().toLowerCase();
    if (!company) return undefined;
    return rejectionMemory.find((r) => (r.company ?? '').trim().toLowerCase() === company);
}

// `mediumThreshold` mirrors claudeCli.js's qualifyAll — kept in parity so e2e (which
// runs against this fake path) can exercise SearchPreferences.autoDismissBelowScore.
/** @param {number} [mediumThreshold] @returns {Promise<Record<string, {fit: string, score: number, signals: {label: string, polarity: string}[]}>>} */
export async function qualifyAll(candidates, jobTitles, locations, cvText, workModes = [], rejectionMemory = [], mediumThreshold) {
    const targetWords = new Set(jobTitles.join(' ').toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const cvWords = cvText ? significantWords(cvText) : null;
    const map = {};
    for (const c of candidates) {
        const words = c.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const overlap = words.filter((w) => targetWords.has(w)).length;
        let score = overlap >= 2 ? BASE_SCORE.high : overlap === 1 ? BASE_SCORE.medium : BASE_SCORE.low;
        const signals = [
            overlap >= 2
                ? { label: 'Title aligned', polarity: 'positive' }
                : overlap === 1
                  ? { label: 'Partial title match', polarity: 'neutral' }
                  : { label: 'Off-topic title', polarity: 'negative' },
        ];

        const locOk = locationMatches(c.location, locations);
        if (!locOk) {
            score = Math.max(0, score - DOWNGRADE_STEP);
            signals.push({ label: 'Location', polarity: 'negative' });
        } else if (locations.length > 0) {
            signals.push({ label: 'Location', polarity: 'positive' });
        }

        const detectedWorkMode = detectWorkMode(c);
        if (!workModeMatches(detectedWorkMode, workModes)) {
            score = Math.max(0, score - DOWNGRADE_STEP);
            signals.push({ label: `${WORK_MODE_LABELS[detectedWorkMode]} not wanted`, polarity: 'negative' });
        } else if (workModes.length > 0 && detectedWorkMode) {
            signals.push({ label: 'Work mode aligned', polarity: 'positive' });
        }

        if (cvWords) {
            const descWords = significantWords(c.descriptionRaw ?? '');
            const cvOverlap = [...descWords].filter((w) => cvWords.has(w)).length;
            if (cvOverlap === 0) {
                score = Math.max(0, score - DOWNGRADE_STEP);
                signals.push({ label: 'CV mismatch', polarity: 'negative' });
            } else {
                signals.push({ label: 'CV aligned', polarity: 'positive' });
            }
        }

        const rejectedMatch = rejectedSameCompany(c, rejectionMemory);
        if (rejectedMatch) {
            score = Math.max(0, score - DOWNGRADE_STEP);
            signals.push({ label: 'Similar to a past rejection', polarity: 'negative' });
        }

        map[c.id] = { fit: fitFromScore(score, mediumThreshold), score, signals: signals.slice(0, MAX_SIGNALS) };
    }
    return map;
}
