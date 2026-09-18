import { describe, it, expect } from 'vitest';
import { isLikelyRelevant } from '../../server/scraperRelevance.js';

describe('isLikelyRelevant', () => {
    it('accepts a title that shares a significant word with a target job title', () => {
        expect(isLikelyRelevant({ title: 'QA Engineer (H/F)' }, ['QA Engineer'])).toBe(true);
    });

    it('rejects a title with zero word overlap against every target job title', () => {
        expect(isLikelyRelevant({ title: 'Chef de projet BTP' }, ['QA Engineer'])).toBe(false);
    });

    it('is accent- and case-insensitive', () => {
        expect(isLikelyRelevant({ title: 'INGÉNIEUR QA' }, ['ingenieur qa'])).toBe(true);
    });

    it('falls back to the description excerpt when the title alone has no overlap', () => {
        expect(
            isLikelyRelevant(
                { title: 'Ingénieur', descriptionRaw: 'Poste de QA Engineer au sein de notre équipe.' },
                ['QA Engineer']
            )
        ).toBe(true);
    });

    it('rejects when neither title nor description overlap', () => {
        expect(
            isLikelyRelevant({ title: 'Ingénieur', descriptionRaw: 'Poste de chef de projet BTP.' }, ['QA Engineer'])
        ).toBe(false);
    });

    it('is permissive when no job titles are given', () => {
        expect(isLikelyRelevant({ title: 'Anything' }, [])).toBe(true);
    });

    it('is permissive when the target job titles reduce to nothing but stopwords', () => {
        expect(isLikelyRelevant({ title: 'Anything' }, ['de la'])).toBe(true);
    });

    it('matches against any one of several target job titles', () => {
        expect(isLikelyRelevant({ title: 'DevOps Engineer' }, ['QA Engineer', 'DevOps Engineer'])).toBe(true);
    });
});
