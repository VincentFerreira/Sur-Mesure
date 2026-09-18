// Pure normalization helpers applied once at ingest time (server/routes.scraper.js
// POST /run), not at render time — title case, department, remote flag, and company
// fallback all get computed and persisted here rather than recomputed by the client on
// every render. Mirrors scraperDedupe.js's one-pure-function-per-concern style.

// French department code in parentheses at the end of a location string, e.g.
// "Neuilly-sur-Seine (92)" -> "92", "Paris (75)" -> "75". Matches 2-digit metropolitan
// codes, "2A"/"2B" (Corsica), and 3-digit overseas codes (971-976).
const DEPARTMENT_PATTERN = /\((\d{2,3}|2[AB])\)\s*$/i;

export function extractDepartment(location) {
    if (!location) return undefined;
    const match = location.match(DEPARTMENT_PATTERN);
    return match ? match[1].toUpperCase() : undefined;
}

// Matches "remote", "télétravail" (with or without accents, since scraped text isn't
// guaranteed clean UTF-8), "full remote", "100% remote", case-insensitive, anywhere in
// the location string.
const REMOTE_PATTERN = /remote|t[ée]l[ée]travail/i;

export function isRemoteLocation(location) {
    return Boolean(location && REMOTE_PATTERN.test(location));
}

// Some portals (seen on France Travail) return titles/descriptions with literal HTML
// entities instead of decoded text, e.g. "Testeur QA Logiciel &amp; Automatisation"
// rendering as "&amp;" rather than "&". Decodes the handful of entities plausible in
// scraped job text — not a general-purpose HTML decoder.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtmlEntities(text) {
    if (!text) return text;
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

const LOWERCASE_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux']);

// Title-cases a title only when the ENTIRE string is uppercase (no lowercase letter
// anywhere) — this deliberately leaves a mixed-case title untouched, including one
// that merely contains an acronym (e.g. "QA Engineer (H/F)"), since the presence of any
// lowercase letter already tells us the portal didn't send an all-caps string.
export function titleCaseIfAllCaps(title) {
    if (!title) return title;
    const hasLetter = /[a-zà-ÿ]/i.test(title);
    const hasLowercase = /[a-zà-ÿ]/.test(title);
    if (!hasLetter || hasLowercase) return title;

    return title
        .toLowerCase()
        .split(/(\s+|[-/])/) // keep separators as their own tokens so they're preserved verbatim
        .map((token, i) => {
            if (/^\s+$/.test(token) || token === '-' || token === '/') return token;
            if (i > 0 && LOWERCASE_WORDS.has(token)) return token;
            return token.charAt(0).toUpperCase() + token.slice(1);
        })
        .join('');
}

// Readable fallback company name when a portal gave no company, using the portal's own
// display name (mirrors components/scraper/scrapedJobMeta.ts's PORTAL_LABELS on the
// client — duplicated here per this codebase's established server/client constant-
// duplication convention: the server is plain Node ESM and can't import client .ts
// modules; SCRAPED_JOB_FITS is likewise duplicated between types.ts and
// routes.scraper.js).
const PORTAL_DISPLAY_NAMES = {
    france_travail: 'France Travail',
    arbeitnow: 'Arbeitnow',
    freehire: 'Freehire',
    claude_cli: 'Claude (recherche web)',
    fake: 'Fake (test)',
};

export function companyOrFallback(company, portal) {
    if (company && company.trim()) return company.trim();
    const portalName = PORTAL_DISPLAY_NAMES[portal] ?? portal;
    return `Offre ${portalName}`;
}
