import { describe, it, expect } from 'vitest';
import { makeFingerprint } from '../../server/scraperFingerprint.js';

describe('makeFingerprint', () => {
    it('uses the portal:externalId format when an external id is given', () => {
        expect(makeFingerprint({ portal: 'france_travail', externalId: '203TXPY', company: 'Acme', title: 'QA Engineer' })).toBe(
            'france_travail:203TXPY'
        );
    });

    it('takes the externalId branch even when company/title are also present', () => {
        const withId = makeFingerprint({ portal: 'arbeitnow', externalId: 'acme-qa-engineer', company: 'Acme', title: 'QA Engineer' });
        expect(withId).toBe('arbeitnow:acme-qa-engineer');
    });

    it('falls back to a hash of slug(company)+slug(title)+department when there is no external id', () => {
        const fp = makeFingerprint({ portal: 'freehire', company: 'Acme', title: 'QA Engineer', department: '75' });
        expect(fp).toMatch(/^hash:[0-9a-f]{64}$/);
    });

    it('is deterministic for identical inputs', () => {
        const a = makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: '75' });
        const b = makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: '75' });
        expect(a).toBe(b);
    });

    it('differs when department differs, same company/title', () => {
        const paris = makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: '75' });
        const nantes = makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: '44' });
        expect(paris).not.toBe(nantes);
    });

    it('is accent- and case-insensitive via slugify reuse', () => {
        const a = makeFingerprint({ company: 'Société Générale', title: 'Ingénieur QA', department: '75' });
        const b = makeFingerprint({ company: 'societe generale', title: 'INGENIEUR QA', department: '75' });
        expect(a).toBe(b);
    });

    it('produces a stable value even when department is missing', () => {
        const fp = makeFingerprint({ company: 'Acme', title: 'QA Engineer' });
        expect(fp).toMatch(/^hash:[0-9a-f]{64}$/);
        expect(fp).toBe(makeFingerprint({ company: 'Acme', title: 'QA Engineer', department: undefined }));
    });

    it('ignores portal entirely in the hash branch', () => {
        const a = makeFingerprint({ portal: 'france_travail', company: 'Acme', title: 'QA Engineer', department: '75' });
        const b = makeFingerprint({ portal: 'freehire', company: 'Acme', title: 'QA Engineer', department: '75' });
        expect(a).toBe(b);
    });
});
