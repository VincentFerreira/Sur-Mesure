import { describe, it, expect } from 'vitest';
import { search, expandKeywords, qualifyAll, generateApplicationText } from '../../server/scrapers/fake.js';

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
    it('rates strong title overlap with the target titles as high fit, with a score and signals', async () => {
        const result = await qualifyAll([{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result['1'].fit).toBe('high');
        expect(result['1'].score).toBeGreaterThanOrEqual(0);
        expect(result['1'].score).toBeLessThanOrEqual(100);
        expect(result['1'].signals.length).toBeGreaterThan(0);
        expect(result['1'].signals[0]).toEqual({ label: 'Title aligned', polarity: 'positive' });
    });

    it('rates a genuinely different job family as low fit', async () => {
        const result = await qualifyAll([{ id: '1', title: 'Sales Manager', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result['1'].fit).toBe('low');
    });

    it('respects a custom mediumThreshold (SearchPreferences.autoDismissBelowScore) instead of the default 45', async () => {
        // Single-word title overlap ("qa") -> BASE_SCORE.medium (60), no other
        // location/workMode/CV penalties applied (locations/workModes empty, no cvText).
        const candidates = [{ id: '1', title: 'QA Consultant', company: 'Acme' }];
        const defaultResult = await qualifyAll(candidates, ['QA Engineer'], [], undefined);
        expect(defaultResult['1'].score).toBe(60);
        expect(defaultResult['1'].fit).toBe('medium'); // 60 >= default 45

        const raisedResult = await qualifyAll(candidates, ['QA Engineer'], [], undefined, [], [], 65);
        expect(raisedResult['1'].fit).toBe('low'); // 60 < custom 65
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
        expect(result['1'].fit).toBe('high');
    });

    it('downgrades fit by one level when the location does not match any target location', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Berlin' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1'].fit).toBe('medium');
    });

    it('keeps fit when the location matches a target location', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Paris, France' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1'].fit).toBe('high');
    });

    it('treats a "Remote"-style target location as satisfied by any remote posting', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', location: 'Remote (worldwide)' }],
            ['QA Engineer'],
            ['Remote France'],
            undefined
        );
        expect(result['1'].fit).toBe('high');
    });

    it('never upgrades an off-topic title to a passing fit based on location alone', async () => {
        const result = await qualifyAll(
            [{ id: '1', title: 'Sales Manager', company: 'Acme', location: 'Paris' }],
            ['QA Engineer'],
            ['Paris'],
            undefined
        );
        expect(result['1'].fit).toBe('low');
    });

    describe('with acceptable work modes configured', () => {
        it('downgrades fit and tags the mismatch when an on-site-only posting is not acceptable', async () => {
            const result = await qualifyAll(
                [
                    {
                        id: '1',
                        title: 'Senior QA Engineer',
                        company: 'Acme',
                        location: 'Paris',
                        descriptionRaw: 'Poste 100% présentiel, aucun télétravail possible.',
                    },
                ],
                ['QA Engineer'],
                [],
                undefined,
                ['hybrid', 'remote']
            );
            expect(result['1'].fit).toBe('medium');
            expect(result['1'].signals).toContainEqual({ label: 'Onsite not wanted', polarity: 'negative' });
        });

        it('does not downgrade when the detected work mode is acceptable', async () => {
            const result = await qualifyAll(
                [
                    {
                        id: '1',
                        title: 'Senior QA Engineer',
                        company: 'Acme',
                        descriptionRaw: 'Poste hybride, 2 jours de télétravail par semaine.',
                    },
                ],
                ['QA Engineer'],
                [],
                undefined,
                ['hybrid', 'remote']
            );
            expect(result['1'].fit).toBe('high');
            expect(result['1'].signals).toContainEqual({ label: 'Work mode aligned', polarity: 'positive' });
        });

        it('does not downgrade when no work mode preference is configured', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', descriptionRaw: '100% présentiel, aucun télétravail.' }],
                ['QA Engineer'],
                [],
                undefined,
                []
            );
            expect(result['1'].fit).toBe('high');
        });

        it('does not penalize when the work mode cannot be determined from the text', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', descriptionRaw: 'Great team, competitive salary.' }],
                ['QA Engineer'],
                [],
                undefined,
                ['remote']
            );
            expect(result['1'].fit).toBe('high');
        });
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
            expect(result['1'].fit).toBe('high');
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
            expect(result['1'].fit).toBe('medium');
        });

        it('never upgrades an off-topic title to a passing fit based on the CV alone', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Sales Manager', company: 'Acme', descriptionRaw: 'Playwright and Cypress automation experience wanted.' }],
                ['QA Engineer'],
                [],
                cvText
            );
            expect(result['1'].fit).toBe('low');
        });

        it('does not affect fit when no CV is provided (backward compatible)', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme', descriptionRaw: 'Unrelated content entirely.' }],
                ['QA Engineer'],
                [],
                undefined
            );
            expect(result['1'].fit).toBe('high');
        });
    });

    describe('with rejection memory', () => {
        it('downgrades fit by one level and tags a candidate from a previously-rejected company', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }],
                ['QA Engineer'],
                [],
                undefined,
                [],
                [{ title: 'QA Engineer', company: 'Acme', reason: 'ESN / régie' }]
            );
            expect(result['1'].fit).toBe('medium');
            expect(result['1'].signals).toContainEqual({ label: 'Similar to a past rejection', polarity: 'negative' });
        });

        it('does not downgrade a candidate from an unrelated company', async () => {
            const result = await qualifyAll(
                [{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }],
                ['QA Engineer'],
                [],
                undefined,
                [],
                [{ title: 'QA Engineer', company: 'Other Co', reason: 'ESN / régie' }]
            );
            expect(result['1'].fit).toBe('high');
        });

        it('does not affect fit when no rejection memory is given (backward compatible)', async () => {
            const result = await qualifyAll([{ id: '1', title: 'Senior QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
            expect(result['1'].fit).toBe('high');
        });
    });
});

describe('generateApplicationText (fake)', () => {
    it('returns a non-empty string referencing the job and a CV snippet, for every text type', async () => {
        for (const textType of ['quick_pitch', 'full_pitch', 'referral_message'] as const) {
            const text = await generateApplicationText(
                'QA Engineer', 'Acme', 'desc', 'EXPERIENCE\n- Automated a full regression suite', textType
            );
            expect(text.length).toBeGreaterThan(0);
            expect(text).toContain('QA Engineer');
            expect(text).toContain('Acme');
            expect(text).toContain('Automated a full regression suite');
        }
    });

    it('varies the output by textType (never returns the exact same string for different types)', async () => {
        const quick = await generateApplicationText('QA Engineer', 'Acme', 'desc', 'EXPERIENCE\n- X', 'quick_pitch');
        const referral = await generateApplicationText('QA Engineer', 'Acme', 'desc', 'EXPERIENCE\n- X', 'referral_message');
        expect(quick).not.toBe(referral);
    });
});
