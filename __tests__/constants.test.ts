import { describe, it, expect } from 'vitest';
import { INITIAL_CV_DATA } from '../constants';
import { LANGUAGE_CODES } from '../lib/i18n';

describe('INITIAL_CV_DATA', () => {
  it('has a valid currentLanguage', () => {
    expect(LANGUAGE_CODES).toContain(INITIAL_CV_DATA.currentLanguage);
  });

  describe('personalInfo', () => {
    it('has non-empty firstName and lastName', () => {
      expect(INITIAL_CV_DATA.personalInfo.firstName).toBeTruthy();
      expect(INITIAL_CV_DATA.personalInfo.lastName).toBeTruthy();
    });

    it('has a valid email format', () => {
      expect(INITIAL_CV_DATA.personalInfo.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });

    it('has a bilingual title for every language code', () => {
      for (const code of LANGUAGE_CODES) {
        expect(INITIAL_CV_DATA.personalInfo.title[code]).toBeTruthy();
      }
    });

    it('has a bilingual summary for every language code', () => {
      for (const code of LANGUAGE_CODES) {
        expect(INITIAL_CV_DATA.personalInfo.summary[code]).toBeTruthy();
      }
    });
  });

  describe('skills', () => {
    it('has at least one skill category', () => {
      expect(INITIAL_CV_DATA.skills.length).toBeGreaterThan(0);
    });

    it('every skill category has a unique non-empty id', () => {
      const ids = INITIAL_CV_DATA.skills.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toBeTruthy();
    });

    it('every skill category has a bilingual name', () => {
      for (const skill of INITIAL_CV_DATA.skills) {
        for (const code of LANGUAGE_CODES) {
          expect(skill.name[code]).toBeTruthy();
        }
      }
    });
  });

  describe('experience', () => {
    it('has at least one experience entry', () => {
      expect(INITIAL_CV_DATA.experience.length).toBeGreaterThan(0);
    });

    it('every experience entry has a unique non-empty id', () => {
      const ids = INITIAL_CV_DATA.experience.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toBeTruthy();
    });

    it('every experience entry has a non-empty company', () => {
      for (const exp of INITIAL_CV_DATA.experience) {
        expect(exp.company).toBeTruthy();
      }
    });

    it('every experience entry has a bilingual role', () => {
      for (const exp of INITIAL_CV_DATA.experience) {
        for (const code of LANGUAGE_CODES) {
          expect(exp.role[code]).toBeTruthy();
        }
      }
    });

    it('every experience entry has description arrays for all languages', () => {
      for (const exp of INITIAL_CV_DATA.experience) {
        for (const code of LANGUAGE_CODES) {
          expect(Array.isArray(exp.description[code])).toBe(true);
          expect((exp.description[code] ?? []).length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('education', () => {
    it('has at least one education entry', () => {
      expect(INITIAL_CV_DATA.education.length).toBeGreaterThan(0);
    });

    it('every education entry has a non-empty school', () => {
      for (const edu of INITIAL_CV_DATA.education) {
        expect(edu.school).toBeTruthy();
      }
    });

    it('every education entry has a single numeric year', () => {
      for (const edu of INITIAL_CV_DATA.education) {
        expect(edu.year).toMatch(/^\d{4}$/);
      }
    });
  });

  describe('languages', () => {
    it('has language entries for every language code', () => {
      for (const code of LANGUAGE_CODES) {
        expect(Array.isArray(INITIAL_CV_DATA.languages[code])).toBe(true);
        expect((INITIAL_CV_DATA.languages[code] ?? []).length).toBeGreaterThan(0);
      }
    });
  });
});
