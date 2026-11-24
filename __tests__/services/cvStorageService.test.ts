// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listCVs,
  loadCV,
  createCV,
  saveCV,
  deleteCV,
  duplicateCV,
  autoSaveToLocalStorage,
  restoreFromLocalStorage,
  migrateCV,
} from '../../services/cvStorageService';
import type { CVData } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = (body: unknown, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
};

const minimalCV = (): CVData => ({
  currentLanguage: 'fr',
  personalInfo: {
    firstName: 'Alice',
    lastName: 'TEST',
    title: { fr: 'Dev', en: 'Dev' },
    email: 'alice@test.com',
    medium: '',
    location: 'Paris',
    linkedin: '',
    github: '',
    photo: null,
    summary: { fr: '', en: '' },
  },
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  languages: { fr: [], en: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ── listCVs ───────────────────────────────────────────────────────────────────

describe('listCVs', () => {
  it('returns an array of CV metadata', async () => {
    const metas = [{ id: 'abc', label: 'My CV', updatedAt: 1, createdAt: 1 }];
    mockFetch(metas);
    const result = await listCVs();
    expect(result).toEqual(metas);
  });

  it('throws when the response is not ok', async () => {
    mockFetch({ error: 'Server error' }, 500);
    await expect(listCVs()).rejects.toThrow('Failed to list CVs');
  });
});

// ── loadCV ────────────────────────────────────────────────────────────────────

describe('loadCV', () => {
  it('returns the CV record for a given id', async () => {
    const record = { id: 'abc', label: 'My CV', data: minimalCV(), updatedAt: 1, createdAt: 1 };
    mockFetch(record);
    const result = await loadCV('abc');
    expect(result.id).toBe('abc');
    expect(result.label).toBe('My CV');
  });

  it('throws when CV not found', async () => {
    mockFetch({ error: 'CV not found' }, 404);
    await expect(loadCV('nonexistent')).rejects.toThrow('CV not found');
  });
});

// ── createCV ──────────────────────────────────────────────────────────────────

describe('createCV', () => {
  it('returns the created CV metadata', async () => {
    const meta = { id: 'new-id', label: 'New CV', updatedAt: 1, createdAt: 1 };
    mockFetch(meta, 200);
    const result = await createCV('New CV', minimalCV());
    expect(result.id).toBe('new-id');
    expect(result.label).toBe('New CV');
  });

  it('posts to the correct URL with label and data', async () => {
    mockFetch({ id: 'x', label: 'X', updatedAt: 1, createdAt: 1 });
    const cv = minimalCV();
    await createCV('X', cv);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cvs'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when creation fails', async () => {
    mockFetch({ error: 'Failed' }, 400);
    await expect(createCV('X', minimalCV())).rejects.toThrow('Failed to create CV');
  });
});

// ── saveCV ────────────────────────────────────────────────────────────────────

describe('saveCV', () => {
  it('returns updated CV metadata', async () => {
    const meta = { id: 'abc', label: 'Updated', updatedAt: 999 };
    mockFetch(meta);
    const result = await saveCV('abc', 'Updated', minimalCV());
    expect(result.label).toBe('Updated');
  });

  it('throws when save fails', async () => {
    mockFetch({ error: 'Not found' }, 404);
    await expect(saveCV('abc', 'Updated', minimalCV())).rejects.toThrow('Failed to save CV');
  });
});

// ── duplicateCV ───────────────────────────────────────────────────────────────

describe('duplicateCV', () => {
  it('posts to the duplicateOf endpoint and returns the copy metadata', async () => {
    const meta = { id: 'copy', label: 'My CV (copy)', updatedAt: 2, createdAt: 2 };
    mockFetch(meta);
    await expect(duplicateCV('abc')).resolves.toEqual(meta);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cvs?duplicateOf=abc'),
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it('throws when the response is not ok', async () => {
    mockFetch({ error: 'Not found' }, 404);
    await expect(duplicateCV('nonexistent')).rejects.toThrow('Failed to duplicate CV');
  });
});

// ── deleteCV ──────────────────────────────────────────────────────────────────

describe('deleteCV', () => {
  it('resolves without error on success', async () => {
    mockFetch({ success: true });
    await expect(deleteCV('abc')).resolves.toBeUndefined();
  });

  it('throws when deletion fails', async () => {
    mockFetch({ error: 'Not found' }, 404);
    await expect(deleteCV('nonexistent')).rejects.toThrow('Failed to delete CV');
  });
});

// ── autoSaveToLocalStorage / restoreFromLocalStorage ──────────────────────────

describe('autoSaveToLocalStorage', () => {
  it('persists CV data to localStorage', () => {
    const cv = minimalCV();
    autoSaveToLocalStorage(cv);
    const raw = localStorage.getItem('cv_autosave');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).currentLanguage).toBe('fr');
  });

  it('does not throw if localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => autoSaveToLocalStorage(minimalCV())).not.toThrow();
  });
});

describe('restoreFromLocalStorage', () => {
  it('returns null when nothing is saved', () => {
    expect(restoreFromLocalStorage()).toBeNull();
  });

  it('returns the saved CV data', () => {
    const cv = minimalCV();
    localStorage.setItem('cv_autosave', JSON.stringify(cv));
    const result = restoreFromLocalStorage();
    expect(result?.currentLanguage).toBe('fr');
    expect(result?.personalInfo.firstName).toBe('Alice');
  });

  it('returns null when localStorage contains invalid JSON', () => {
    localStorage.setItem('cv_autosave', '{invalid}');
    expect(restoreFromLocalStorage()).toBeNull();
  });
});

// ── migrateCV ─────────────────────────────────────────────────────────────────

describe('migrateCV', () => {
  it('returns null for invalid input', () => {
    expect(migrateCV(null)).toBeNull();
    expect(migrateCV({})).toBeNull();
    expect(migrateCV({ personalInfo: {} })).toBeNull();
  });

  it('converts single-language string fields to bilingual objects', () => {
    const old = {
      personalInfo: { title: 'Dev', summary: 'Summary text', firstName: 'Bob', lastName: 'TEST', email: '', medium: '', location: '', linkedin: '', github: '', photo: null },
      skills: [{ id: '1', name: 'JS', items: 'React' }],
      experience: [{
        id: 'e1', role: 'Engineer', company: 'Acme', location: 'Paris',
        startDate: '2020', endDate: '2022',
        description: ['Did things'], techStack: 'React',
      }],
      education: [{ id: 'edu1', school: 'MIT', degree: 'BSc', location: '', startDate: '2018', endDate: '2021', description: 'great' }],
      languages: ['French', 'English'],
    };

    const result = migrateCV(old);
    expect(result).not.toBeNull();
    expect(result!.personalInfo.title).toEqual({ fr: 'Dev', en: 'Dev' });
    expect(result!.personalInfo.summary).toEqual({ fr: 'Summary text', en: 'Summary text' });
    expect(result!.skills[0].name).toEqual({ fr: 'JS', en: 'JS' });
    expect(result!.experience[0].role).toEqual({ fr: 'Engineer', en: 'Engineer' });
    expect(result!.experience[0].description).toEqual({ fr: ['Did things'], en: ['Did things'] });
    expect(result!.education[0].degree).toEqual({ fr: 'BSc', en: 'BSc' });
    expect(result!.education[0].year).toBe('2021');
    expect(result!.education[0]).not.toHaveProperty('startDate');
    expect(result!.education[0]).not.toHaveProperty('endDate');
    expect(result!.languages).toEqual({ fr: ['French', 'English'], en: ['French', 'English'] });
  });

  it('migrates education start/end dates to a single year, falling back to the start year', () => {
    const base = {
      personalInfo: { title: 'Dev', summary: 's' },
      skills: [], experience: [], languages: [],
    };
    const result = migrateCV({
      ...base,
      education: [
        { id: 'a', school: 'X', degree: 'D', location: '', startDate: '2018', endDate: '', description: '' },
        { id: 'b', school: 'Y', degree: 'D', location: '', year: '2015', description: '' },
      ],
    });
    expect(result!.education[0].year).toBe('2018');
    expect(result!.education[1].year).toBe('2015');
  });

  it('leaves already-bilingual objects unchanged', () => {
    const alreadyBilingual = {
      currentLanguage: 'fr',
      personalInfo: {
        title: { fr: 'Dev FR', en: 'Dev EN' },
        summary: { fr: 'Résumé', en: 'Summary' },
        firstName: 'Bob', lastName: 'TEST', email: '', medium: '', location: '', linkedin: '', github: '', photo: null,
      },
      skills: [{ id: '1', name: { fr: 'JS', en: 'JS' }, items: { fr: 'React', en: 'React' } }],
      experience: [],
      education: [],
      languages: { fr: ['Français'], en: ['French'] },
    };

    const result = migrateCV(alreadyBilingual);
    expect(result!.personalInfo.title).toEqual({ fr: 'Dev FR', en: 'Dev EN' });
    expect(result!.languages).toEqual({ fr: ['Français'], en: ['French'] });
  });

  it('defaults currentLanguage to fr when absent', () => {
    const old = {
      personalInfo: { firstName: 'X', lastName: 'Y', title: 'T', summary: 'S', email: '', medium: '', location: '', linkedin: '', github: '', photo: null },
      skills: [],
      experience: [],
      education: [],
      languages: [],
    };
    const result = migrateCV(old);
    expect(result!.currentLanguage).toBe('fr');
  });
});
