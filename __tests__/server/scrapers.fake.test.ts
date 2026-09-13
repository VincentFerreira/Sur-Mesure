import { describe, it, expect } from 'vitest';
import { search, expandKeywords, qualifyAll } from '../../server/scrapers/fake.js';

describe('search (fake)', () => {
    it('returns a single deterministic posting referencing the query and location', async () => {
        const results = await search({ query: 'QA Engineer', location: 'Paris' });
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('QA Engineer');
        expect(results[0].location).toBe('Paris');
    });
});

// Ported from the removed services/aiService.ts fake-provider tests (see
// __tests__/services/aiService.test.ts git history) now that expand/qualify run
// server-side via the `claude` CLI — server/scrapers/fake.js is the deterministic,
// no-network stand-in used whenever NODE_ENV=test or SCRAPER_PROVIDER=fake (see
// server/routes.scraper.js's useFakeAi).

describe('expandKeywords (fake)', () => {
    it('returns the input unchanged (no network call)', async () => {
        const titles = ['QA Engineer', 'SDET'];
        expect(await expandKeywords(titles)).toEqual(titles);
    });
});

describe('qualifyAll (fake)', () => {
    it('rates strong title overlap with the target titles as high fit', async () => {
        const result = await qualifyAll([{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result['1']).toBe('high');
    });

    it('rates a genuinely different job family as low fit', async () => {
        const result = await qualifyAll([{ id: '1', title: 'Sales Manager', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result['1']).toBe('low');
    });

    it('processes all candidates without losing any result', async () => {
        const candidates = Array.from({ length: 60 }, (_, i) => ({ id: String(i), title: 'QA Engineer', company: 'Acme' }));
        const result = await qualifyAll(candidates, ['QA Engineer'], [], undefined);
        expect(Object.keys(result)).toHaveLength(60);
    });

    it('does not downgrade fit for location when no target locations are configured', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Berlin' }],
            ['QA Engineer'],
            [],
            undefined
        );
        expect(result['1']).toBe('high');
    });

    it('downgrades fit by one level when the location does not match any target location', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Berlin' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1']).toBe('medium');
    });

    it('keeps fit when the location matches a target location', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Paris, France' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1']).toBe('high');
    });

    it('treats a "Remote"-style target location as satisfied by any remote posting', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Remote (worldwide)' }],
            ['QA Engineer'],
            ['Remote France'],
            undefined
        );
        expect(result['1']).toBe('high');
    });

    it('never upgrades an off-topic title to a passing fit based on location alone', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Sales Manager', company: 'Acme', location: 'Paris' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1']).toBe('low');
    });

    describe('with a CV provided', () => {
        const cvText = 'Experienced QA Engineer with Playwright, Cypress and TypeScript automation background.';

        it('does not downgrade fit when the CV shares significant words with the posting description', async () => {
            const result = await qualifyAll(
                [
                    {
                        id: '1',
                        title: 'Senior QA Engineer',
                        company: 'Acme',
                        descriptionRaw: 'Looking for someone with Playwright and Cypress automation experience.',
                    },
                ],
                ['QA Engineer'],
                [],
                cvText
            );
            expect(result['1']).toBe('high');
        });

        it('downgrades fit by one level when the CV shares no significant words with the posting description', async () => {
            const result = await qualifyAll(
                [
                    {
                        id: '1',
                        title: 'Senior QA Engineer',
                        company: 'Acme',
                        descriptionRaw: 'Looking for someone with strong knowledge of maritime logistics and customs paperwork.',
                    },
                ],
                ['QA Engineer'],
                [],
                cvText
            );
            expect(result['1']).toBe('medium');
        });

        it('never upgrades an off-topic title to a passing fit based on the CV alone', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Sales Manager', company: 'Acme', descriptionRaw: 'Playwright and Cypress automation experience wanted.' }],
                ['QA Engineer'],
                [],
                cvText
            );
            expect(result['1']).toBe('low');
        });

        it('does not affect fit when no CV is provided (backward compatible)', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', descriptionRaw: 'Unrelated content entirely.' }],
                ['QA Engineer'],
                [],
                undefined
            );
            expect(result['1']).toBe('high');
        });
    });
});
