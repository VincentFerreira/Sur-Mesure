import { fetchWithBackoff, stripHtml } from './httpUtils.js';

// Portal module for Arbeitnow's public job board API (https://www.arbeitnow.com/api/job-board-api)
// — genuinely zero-config: no key, no registration, no OAuth, unlike France Travail.
// Trade-off: the API has no server-side keyword/location search, only pagination — so
// this module fetches a bounded window of recent postings once (cached briefly to
// respect "please do not abuse" in their terms) and filters client-side per query.
export const id = 'arbeitnow';

const BASE_URL = 'https://www.arbeitnow.com/api/job-board-api';
const MAX_PAGES = 3;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { fetchedAt: 0, jobs: [] };

async function fetchAllJobs() {
    if (cache.jobs.length > 0 && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.jobs;
    }

    const jobs = [];
    let url = `${BASE_URL}?page=1`;
    for (let page = 0; page < MAX_PAGES && url; page += 1) {
        const res = await fetchWithBackoff(url);
        if (!res.ok) break;
        const data = await res.json();
        jobs.push(...(Array.isArray(data.data) ? data.data : []));
        url = data.links?.next || null;
    }

    cache = { fetchedAt: Date.now(), jobs };
    return jobs;
}

export function matchesQuery(job, query, location) {
    const haystack = `${job.title} ${(job.tags ?? []).join(' ')}`.toLowerCase();
    const queryOk = !query || haystack.includes(query.toLowerCase());
    const locationOk = !location || (job.location ?? '').toLowerCase().includes(location.toLowerCase());
    return queryOk && locationOk;
}

export function normalize(job) {
    return {
        title: job.title,
        company: job.company_name || 'Unknown company',
        location: job.location || undefined,
        url: job.url,
        postedDate: job.created_at ? new Date(job.created_at * 1000).toISOString().slice(0, 10) : undefined,
        descriptionRaw: stripHtml(job.description),
    };
}

export async function search({ query, location }) {
    const jobs = await fetchAllJobs();
    return jobs.filter((job) => matchesQuery(job, query, location)).map(normalize);
}
