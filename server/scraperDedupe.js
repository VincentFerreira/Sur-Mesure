const MAX_KEY_LENGTH = 120;
const DIACRITICS_RANGE = new RegExp('[̀-ͯ]', 'g');

export function slugify(value) {
    return value
        .normalize('NFD')
        .replace(DIACRITICS_RANGE, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Canonical dedup key for a scraped posting: company+title slug, so the same posting
// re-surfacing across runs (or across portals) is recognized as "already seen" rather
// than creating a duplicate candidate. Ported from the slugify approach in
// ai-job-search's tools/job_key.py.
export function makeDedupeKey(company, title) {
    const slug = `${slugify(company ?? '')}_${slugify(title ?? '')}`;
    return slug.length > MAX_KEY_LENGTH ? slug.slice(0, MAX_KEY_LENGTH) : slug;
}
