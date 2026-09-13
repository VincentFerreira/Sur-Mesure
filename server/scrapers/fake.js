// Deterministic, no-network portal used by tests and e2e — same role as the `fake`
// AI provider in aiService.ts / VITE_ATS_PROVIDER=fake. Never hits a real API, so tests
// don't depend on France Travail credentials or network access. Returns results that
// reference `query`/`location` so a test can assert the search parameters were passed
// through correctly.
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

/** @returns {Promise<Record<string, string>>} */
export async function qualifyAll(candidates, jobTitles, locations, cvText) {
    const targetWords = new Set(jobTitles.join(' ').toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const cvWords = cvText ? significantWords(cvText) : null;
    /** @type {Record<string, string>} */
    const map = {};
    for (const c of candidates) {
        const words = c.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const overlap = words.filter((w) => targetWords.has(w)).length;
        let fit = overlap >= 2 ? 'high' : overlap === 1 ? 'medium' : 'low';
        if (fit !== 'low' && !locationMatches(c.location, locations)) {
            fit = fit === 'high' ? 'medium' : 'low';
        }
        if (fit !== 'low' && cvWords) {
            const descWords = significantWords(c.descriptionRaw ?? '');
            const cvOverlap = [...descWords].filter((w) => cvWords.has(w)).length;
            if (cvOverlap === 0) fit = fit === 'high' ? 'medium' : 'low';
        }
        map[c.id] = fit;
    }
    return map;
}
