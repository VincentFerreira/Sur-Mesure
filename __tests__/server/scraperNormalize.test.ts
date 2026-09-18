import { describe, it, expect } from 'vitest';
import {
    extractDepartment,
    isRemoteLocation,
    titleCaseIfAllCaps,
    companyOrFallback,
    decodeHtmlEntities,
} from '../../server/scraperNormalize.js';

describe('extractDepartment', () => {
    it('extracts a 2-digit department from a parenthesized suffix', () => {
        expect(extractDepartment('Neuilly-sur-Seine (92)')).toBe('92');
    });

    it('extracts a Corsica code', () => {
        expect(extractDepartment('Ajaccio (2A)')).toBe('2A');
    });

    it('extracts a 3-digit overseas department code', () => {
        expect(extractDepartment('Fort-de-France (972)')).toBe('972');
    });

    it('returns undefined when there is no parenthesized code', () => {
        expect(extractDepartment('Paris')).toBeUndefined();
    });

    it('returns undefined for a missing location', () => {
        expect(extractDepartment(undefined)).toBeUndefined();
    });
});

describe('isRemoteLocation', () => {
    it('detects "Remote" case-insensitively', () => {
        expect(isRemoteLocation('Remote (worldwide)')).toBe(true);
        expect(isRemoteLocation('remote')).toBe(true);
    });

    it('detects "Télétravail" with or without accents', () => {
        expect(isRemoteLocation('Télétravail total')).toBe(true);
        expect(isRemoteLocation('teletravail')).toBe(true);
    });

    it('is false for an on-site location', () => {
        expect(isRemoteLocation('Paris (75)')).toBe(false);
    });

    it('is false for a missing location', () => {
        expect(isRemoteLocation(undefined)).toBe(false);
    });
});

describe('titleCaseIfAllCaps', () => {
    it('title-cases a fully-uppercase title', () => {
        expect(titleCaseIfAllCaps('DEVELOPPEUR FULLSTACK JAVA')).toBe('Developpeur Fullstack Java');
    });

    it('keeps short French connector words lowercase unless they are the first word', () => {
        expect(titleCaseIfAllCaps('INGENIEUR DE PRODUCTION')).toBe('Ingenieur de Production');
    });

    it('leaves a mixed-case title (e.g. containing an acronym) untouched', () => {
        expect(titleCaseIfAllCaps('QA Engineer (H/F)')).toBe('QA Engineer (H/F)');
    });

    it('leaves a title with no letters untouched', () => {
        expect(titleCaseIfAllCaps('123')).toBe('123');
    });

    it('passes through a falsy title unchanged', () => {
        expect(titleCaseIfAllCaps(undefined)).toBeUndefined();
        expect(titleCaseIfAllCaps('')).toBe('');
    });
});

describe('companyOrFallback', () => {
    it('returns the given company unchanged when present', () => {
        expect(companyOrFallback('Acme', 'france_travail')).toBe('Acme');
    });

    it('trims the given company', () => {
        expect(companyOrFallback('  Acme  ', 'france_travail')).toBe('Acme');
    });

    it('falls back to a portal-branded label when company is blank', () => {
        expect(companyOrFallback('', 'france_travail')).toBe('Offre France Travail');
        expect(companyOrFallback('   ', 'freehire')).toBe('Offre Freehire');
        expect(companyOrFallback(undefined, 'freehire')).toBe('Offre Freehire');
    });

    it('falls back to the raw portal id when the portal has no known display name', () => {
        expect(companyOrFallback(undefined, 'mystery_portal')).toBe('Offre mystery_portal');
    });
});

describe('decodeHtmlEntities', () => {
    it('decodes the common named entities', () => {
        expect(decodeHtmlEntities('Testeur QA Logiciel &amp; Automatisation')).toBe('Testeur QA Logiciel & Automatisation');
        expect(decodeHtmlEntities('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
        expect(decodeHtmlEntities('&quot;quoted&quot; &apos;text&apos;')).toBe('"quoted" \'text\'');
        expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
    });

    it('decodes decimal and hex numeric entities', () => {
        expect(decodeHtmlEntities('&#38;')).toBe('&');
        expect(decodeHtmlEntities('&#x26;')).toBe('&');
    });

    it('leaves an already-decoded string untouched', () => {
        expect(decodeHtmlEntities('Testeur QA Logiciel & Automatisation')).toBe('Testeur QA Logiciel & Automatisation');
    });

    it('leaves an unrecognized entity-like sequence untouched', () => {
        expect(decodeHtmlEntities('R&D team')).toBe('R&D team');
    });

    it('passes through a falsy value unchanged', () => {
        expect(decodeHtmlEntities(undefined)).toBeUndefined();
        expect(decodeHtmlEntities('')).toBe('');
    });
});
