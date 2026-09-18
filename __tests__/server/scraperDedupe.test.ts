import { describe, it, expect } from 'vitest';
import { makeDedupeKey } from '../../server/scraperDedupe.js';

describe('makeDedupeKey', () => {
    it('slugifies company and title, joined by an underscore', () => {
        expect(makeDedupeKey('Acme Corp', 'Backend Engineer')).toBe('acme-corp_backend-engineer');
    });

    it('strips accents', () => {
        expect(makeDedupeKey('Société Générale', 'Ingénieur QA')).toBe('societe-generale_ingenieur-qa');
    });

    it('is case-insensitive and trims surrounding whitespace', () => {
        expect(makeDedupeKey('  ACME  ', '  Backend Engineer  ')).toBe(makeDedupeKey('acme', 'backend engineer'));
    });

    it('collapses punctuation/whitespace runs into single hyphens with no leading/trailing hyphen', () => {
        expect(makeDedupeKey('Acme, Inc.', 'QA / Automation Lead')).toBe('acme-inc_qa-automation-lead');
    });

    it('caps the key length', () => {
        const longTitle = 'A'.repeat(200);
        const key = makeDedupeKey('Acme', longTitle);
        expect(key.length).toBeLessThanOrEqual(120);
    });

    it('is stable and deterministic for the same input', () => {
        expect(makeDedupeKey('Acme', 'QA Engineer')).toBe(makeDedupeKey('Acme', 'QA Engineer'));
    });
});
