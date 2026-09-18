import { fetchWithBackoff, stripHtml } from './httpUtils.js';

// Portal for freehire.me's public "agent" job search API — a public, key-less JSON
// aggregator across ~50 ATS platforms (ported from ai-job-search's freehire-search
// CLI, which hits the same endpoint the same way — zero runtime deps there either).
export const id = 'freehire';

const SEARCH_URL = 'https://freehire.me/api/v1/agent/jobs/search';
const RESULT_LIMIT = 20;

// Human-readable salary line from the enrichment fields, or undefined when absent
// — same logic as freehire-search's own formatSalary helper.
function formatSalary(enrichment) {
    if (!enrichment) return undefined;
    const { salary_min: min, salary_max: max, salary_currency: currency } = enrichment;
    if (min == null && max == null) return undefined;
    const cur = currency ? `${currency} ` : '';
    if (min != null && max != null) return `${cur}${min}–${max}`;
    return `${cur}${min ?? max}`;
}

function normalize(job) {
    return {
        title: job.title,
        company: job.company || 'Unknown company',
        location: job.location || undefined,
        url: job.url,
        postedDate: job.posted_at ? job.posted_at.slice(0, 10) : undefined,
        descriptionRaw: stripHtml(job.description),
        salaryRange: formatSalary(job.enrichment),
    };
}

// Note: `location` is intentionally not sent as a query filter — see the
// `usesLocation: false` comment in server/scrapers/index.js. Hardcodes
// `countries=fr` instead (this project's whole domain is the French job market),
// relying on the client-side AI qualification pass for finer-grained location
// matching against SearchPreferences.locations, same as france_travail.js.
export async function search({ query }) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('limit', String(RESULT_LIMIT));
    params.set('countries', 'fr');

    const res = await fetchWithBackoff(`${SEARCH_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return [];
    if (!res.ok) {
        throw new Error(`freehire search failed: ${res.status}`);
    }

    const data = await res.json();
    const results = Array.isArray(data.data) ? data.data : [];
    return results.map(normalize).filter((r) => r.title && r.url);
}
