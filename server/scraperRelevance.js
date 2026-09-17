import { slugify } from './scraperDedupe.js';

// Loose anti-noise pre-filter applied at ingest time (server/routes.scraper.js
// POST /run), before a result is persisted and — later — paid for as a slot in a
// claudeCli.qualifyAll batch. Portals are queried with a `query` string derived from
// the target job titles, but that's a keyword search on the upstream side, not a
// guarantee of relevance — a title sharing literally no word with any target job
// title is almost certainly a different job family entirely.
//
// Deliberately permissive: this only catches the obvious case (zero word overlap).
// Fine-grained fit judgment (seniority, location, work mode, CV match) stays
// claudeCli.qualifyAll's job — this is a cheap noise filter, not a second qualifier.
const STOPWORDS = new Set([
    'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'un', 'une', 'au', 'aux',
    'the', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'a', 'an',
]);

function significantWords(text) {
    return slugify(text ?? '')
        .split('-')
        .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Checks the title first (the strongest signal); only falls back to the description
// excerpt when the title alone doesn't overlap, so a generic title (e.g. "Ingénieur")
// paired with an on-topic description isn't wrongly dropped.
/**
 * @param {{ title?: string, descriptionRaw?: string }} item
 * @param {string[]} jobTitles
 * @returns {boolean}
 */
export function isLikelyRelevant({ title, descriptionRaw } = {}, jobTitles) {
    if (!jobTitles || jobTitles.length === 0) return true;
    const targetWords = new Set(jobTitles.flatMap((t) => significantWords(t)));
    if (targetWords.size === 0) return true;

    if (significantWords(title).some((w) => targetWords.has(w))) return true;
    return significantWords(descriptionRaw).some((w) => targetWords.has(w));
}
