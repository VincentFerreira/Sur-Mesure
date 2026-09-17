import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const franceTravailSearch = vi.fn().mockResolvedValue([]);
const arbeitnowSearch = vi.fn().mockResolvedValue([]);
const freehireSearch = vi.fn().mockResolvedValue([]);
const claudeCliSearchAll = vi.fn().mockResolvedValue([]);

vi.mock('../../server/scrapers/franceTravail.js', () => ({ id: 'france_travail', search: (...args: unknown[]) => franceTravailSearch(...args) }));
vi.mock('../../server/scrapers/arbeitnow.js', () => ({ id: 'arbeitnow', search: (...args: unknown[]) => arbeitnowSearch(...args) }));
vi.mock('../../server/scrapers/freehire.js', () => ({ id: 'freehire', search: (...args: unknown[]) => freehireSearch(...args) }));
vi.mock('../../server/scrapers/claudeCli.js', () => ({ id: 'claude_cli', searchAll: (...args: unknown[]) => claudeCliSearchAll(...args) }));
vi.mock('../../server/scrapers/fake.js', () => ({ id: 'fake', search: vi.fn().mockResolvedValue([]) }));

const { runScrape } = await import('../../server/scrapers/index.js');

beforeEach(() => {
    franceTravailSearch.mockClear();
    arbeitnowSearch.mockClear();
    freehireSearch.mockClear();
    claudeCliSearchAll.mockClear();
});

// A portal whose search doesn't use location (france_travail — see its own file for
// why: France Travail's location params require INSEE codes, not free-text place
// names) must be called once per query, not once per (query, location) pair —
// looping over locations for it is pure redundancy and risks tripping its rate limit
// for identical results (this is what an "Unexpected end of JSON input" mid-run
// traced back to before `usesLocation` was added).
describe('runScrape — usesLocation', () => {
    it('calls a location-agnostic portal once per query, ignoring the location list entirely', async () => {
        // Every real portal (including france_travail) is disabled by
        // buildRegistry()'s useFakePortals() whenever NODE_ENV==='test' (to keep them
        // offline during `npm run test`) — irrelevant here since it's mocked above, so
        // it's safe to flip for just this assertion.
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            await (runScrape as (input: { jobTitles: string[]; locations: string[] }) => Promise<unknown>)({
                jobTitles: ['QA Engineer', 'SDET'],
                locations: ['Paris', 'Nantes', 'Remote France'],
            });

            expect(franceTravailSearch).toHaveBeenCalledTimes(2);
            expect(franceTravailSearch).toHaveBeenCalledWith({ query: 'QA Engineer', location: undefined });
            expect(franceTravailSearch).toHaveBeenCalledWith({ query: 'SDET', location: undefined });
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    it('still calls a location-aware portal once per (query, location) pair', async () => {
        // arbeitnow is disabled by buildRegistry() whenever NODE_ENV==='test' (to keep
        // the real module offline during `npm run test`) — irrelevant here since it's
        // mocked above, so it's safe to flip for just this assertion.
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            await (runScrape as (input: { jobTitles: string[]; locations: string[] }) => Promise<unknown>)({
                jobTitles: ['QA Engineer', 'SDET'],
                locations: ['Paris', 'Nantes', 'Remote France'],
            });
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
        }

        expect(arbeitnowSearch).toHaveBeenCalledTimes(6);
        expect(arbeitnowSearch).toHaveBeenCalledWith({ query: 'QA Engineer', location: 'Paris' });
        expect(arbeitnowSearch).toHaveBeenCalledWith({ query: 'SDET', location: 'Remote France' });
    });
});

// claude_cli (server/scrapers/claudeCli.js) is a "single-shot" portal: it shells out
// to the `claude` CLI once per scrape run with the full jobTitles/locations arrays,
// never once per (query, location) pair — a CLI invocation is its own multi-second
// subprocess, so looping it per query the way the HTTP-API portals are would be
// needlessly slow.
describe('runScrape — single-shot portals', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    beforeEach(() => {
        process.env.NODE_ENV = 'development'; // claude_cli is disabled under NODE_ENV=test
    });
    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('calls the single-shot portal exactly once per run, with the full jobTitles/locations arrays', async () => {
        await (runScrape as (input: { jobTitles: string[]; locations: string[] }) => Promise<unknown>)({
            jobTitles: ['QA Engineer', 'SDET'],
            locations: ['Paris', 'Nantes'],
        });

        expect(claudeCliSearchAll).toHaveBeenCalledTimes(1);
        expect(claudeCliSearchAll).toHaveBeenCalledWith({ jobTitles: ['QA Engineer', 'SDET'], locations: ['Paris', 'Nantes'] });
    });

    it('tags its results with its own portal id and reports its count', async () => {
        claudeCliSearchAll.mockResolvedValueOnce([{ title: 'QA Engineer', company: 'Acme', url: 'https://x/1' }]);

        const result = await (runScrape as (input: {
            jobTitles: string[];
            locations: string[];
        }) => Promise<{ results: { portal: string }[]; portalReport: { portal: string; count: number }[] }>)({
            jobTitles: ['QA Engineer'],
            locations: [],
        });

        expect(result.results).toEqual(expect.arrayContaining([expect.objectContaining({ portal: 'claude_cli' })]));
        expect(result.portalReport).toEqual(expect.arrayContaining([{ portal: 'claude_cli', count: 1 }]));
    });

    it('isolates a single-shot portal failure into portalReport without throwing', async () => {
        claudeCliSearchAll.mockRejectedValueOnce(new Error('claude CLI invocation failed: spawn claude ENOENT'));

        const result = await (runScrape as unknown as (input: {
            jobTitles: string[];
            locations: string[];
        }) => Promise<{ portalReport: { portal: string; count: number; error?: string }[] }>)({
            jobTitles: ['QA Engineer'],
            locations: [],
        });

        expect(result.portalReport).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ portal: 'claude_cli', count: 0, error: expect.stringContaining('ENOENT') }),
            ])
        );
    });
});
