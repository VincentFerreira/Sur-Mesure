import { describe, it, expect, vi, afterEach } from 'vitest';
import { search } from '../../server/scrapers/freehire.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('search (freehire)', () => {
    it('queries with countries=fr and the given keyword, no location param', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
        vi.stubGlobal('fetch', fetchMock);

        await search({ query: 'QA Engineer' });

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('q=QA');
        expect(url).toContain('countries=fr');
    });

    it('maps a freehire job onto the shared normalized shape, stripping HTML from the description', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [
                        {
                            title: 'QA Engineer',
                            company: 'Acme',
                            location: 'Paris, France',
                            url: 'https://freehire.me/jobs/qa-engineer-acme',
                            posted_at: '2026-01-02T10:00:00Z',
                            description: '<p>We need a <strong>QA</strong> engineer.</p>',
                            enrichment: { salary_min: 45000, salary_max: 55000, salary_currency: 'EUR' },
                        },
                    ],
                }),
            })
        );

        const results = await search({ query: 'QA Engineer' });
        expect(results).toEqual([
            {
                title: 'QA Engineer',
                company: 'Acme',
                location: 'Paris, France',
                url: 'https://freehire.me/jobs/qa-engineer-acme',
                postedDate: '2026-01-02',
                descriptionRaw: 'We need a QA engineer.',
                salaryRange: 'EUR 45000–55000',
            },
        ]);
    });

    it('falls back to "Unknown company" when company is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ data: [{ title: 'QA', company: '', url: 'https://x/1' }] }),
            })
        );
        const results = await search({ query: 'QA' });
        expect(results[0].company).toBe('Unknown company');
    });

    it('omits salaryRange when neither salary_min nor salary_max is present', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ data: [{ title: 'QA', company: 'Acme', url: 'https://x/1', enrichment: {} }] }),
            })
        );
        const results = await search({ query: 'QA' });
        expect(results[0].salaryRange).toBeUndefined();
    });

    it('drops results missing a title or url', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [
                        { title: 'QA Engineer', company: 'Acme', url: 'https://x/1' },
                        { title: '', company: 'Acme', url: 'https://x/2' },
                        { title: 'QA Engineer', company: 'Acme', url: '' },
                    ],
                }),
            })
        );
        const results = await search({ query: 'QA' });
        expect(results).toHaveLength(1);
        expect(results[0].url).toBe('https://x/1');
    });

    it('returns an empty array for a 404', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        expect(await search({ query: 'QA' })).toEqual([]);
    });

    it('throws on a non-404 error status', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        const assertion = expect(search({ query: 'QA' })).rejects.toThrow('500');
        await vi.runAllTimersAsync();
        await assertion;
        vi.useRealTimers();
    });
});
