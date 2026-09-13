import { describe, it, expect, vi, afterEach } from 'vitest';
import { matchesQuery, normalize, search } from '../../server/scrapers/arbeitnow.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('matchesQuery', () => {
    const job = { title: 'Senior QA Engineer', tags: ['QA', 'Automation'], location: 'Paris, France' };

    it('matches when the query is found in the title or tags, case-insensitively', () => {
        expect(matchesQuery(job, 'qa', undefined)).toBe(true);
        expect(matchesQuery(job, 'Automation', undefined)).toBe(true);
        expect(matchesQuery(job, 'Backend', undefined)).toBe(false);
    });

    it('matches location as a case-insensitive substring', () => {
        expect(matchesQuery(job, undefined, 'paris')).toBe(true);
        expect(matchesQuery(job, undefined, 'Lyon')).toBe(false);
    });

    it('requires both query and location to match when both are given', () => {
        expect(matchesQuery(job, 'QA', 'Paris')).toBe(true);
        expect(matchesQuery(job, 'QA', 'Lyon')).toBe(false);
    });

    it('treats an empty query/location as a wildcard', () => {
        expect(matchesQuery(job, undefined, undefined)).toBe(true);
    });
});

describe('normalize', () => {
    it('maps Arbeitnow fields onto the shared normalized shape', () => {
        const job = {
            title: 'Backend Engineer',
            company_name: 'Acme GmbH',
            location: 'Berlin',
            url: 'https://www.arbeitnow.com/jobs/acme/backend-engineer',
            created_at: 1735689600, // 2025-01-01T00:00:00Z
            description: '<p>We need a <strong>great</strong> engineer.&nbsp;Apply now.</p>',
        };
        expect(normalize(job)).toEqual({
            title: 'Backend Engineer',
            company: 'Acme GmbH',
            location: 'Berlin',
            url: job.url,
            postedDate: '2025-01-01',
            descriptionRaw: 'We need a great engineer. Apply now.',
        });
    });

    it('falls back to "Unknown company" when company_name is missing', () => {
        expect(normalize({ title: 't', company_name: '', url: 'u' }).company).toBe('Unknown company');
    });
});

describe('search', () => {
    it('fetches the job board API and filters results through matchesQuery', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                data: [
                    { title: 'QA Engineer', tags: [], location: 'Paris', company_name: 'Acme', url: 'https://x/1' },
                    { title: 'Sales Manager', tags: [], location: 'Paris', company_name: 'Acme', url: 'https://x/2' },
                ],
                links: { next: null },
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const results = await search({ query: 'QA', location: undefined });
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('QA Engineer');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
