import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted so this mock function exists before the vi.mock factory below runs
// (itself hoisted above the imports) — gives the batch-isolation test a stable
// reference to control what the mocked Gemini client's generateContent resolves to,
// per call.
const mockGeminiGenerateContent = vi.hoisted(() => vi.fn());

// Mock SDKs before importing aiService (vi.mock is hoisted automatically)
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: mockGeminiGenerateContent },
  })),
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: vi.fn() },
  })),
}));

import { serializeCVForATS, withTimeout } from '../../services/aiService';
import type { CVData } from '../../types';

// ── Fixture ───────────────────────────────────────────────────────────────────

const makeCV = (): CVData => ({
  currentLanguage: 'fr',
  personalInfo: {
    firstName: 'Alice',
    lastName: 'DUPONT',
    title: { fr: 'Ingénieure QA', en: 'QA Engineer' },
    email: 'alice@example.com',
    medium: '',
    location: 'Lyon, France',
    linkedin: 'linkedin.com/in/alice',
    github: 'github.com/alice',
    photo: null,
    summary: { fr: 'Experte en tests.', en: 'Testing expert.' },
  },
  skills: [
    { id: '1', name: { fr: 'Test', en: 'Testing' }, items: { fr: 'Playwright, Cypress', en: 'Playwright, Cypress' } },
  ],
  experience: [
    {
      id: 'e1',
      role: { fr: 'Lead QA', en: 'Lead QA' },
      company: 'TechCorp',
      location: 'Lyon',
      startDate: { fr: 'Jan 2020', en: 'Jan 2020' },
      endDate: { fr: "Aujourd'hui", en: 'Today' },
      description: { fr: ['Automatisé les tests'], en: ['Automated tests'] },
      techStack: 'Playwright, CI/CD',
    },
  ],
  education: [
    {
      id: 'edu1',
      school: 'INSA Lyon',
      degree: { fr: 'Master Informatique', en: 'MSc Computer Science' },
      location: 'Lyon',
      startDate: '2016',
      endDate: '2018',
      description: { fr: 'Spécialisation IA', en: 'AI specialisation' },
    },
  ],
  certifications: [],
  languages: { fr: ['Français (Natif)', 'Anglais (Courant)'], en: ['French (Native)', 'English (Fluent)'] },
});

// ── serializeCVForATS ─────────────────────────────────────────────────────────

describe('serializeCVForATS', () => {
  it('includes the personal info section header', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('== PERSONAL INFO ==');
  });

  it('includes name, email and location', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('Alice DUPONT');
    expect(text).toContain('alice@example.com');
    expect(text).toContain('Lyon, France');
  });

  it('includes all language versions of the title', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('Title (FR): Ingénieure QA');
    expect(text).toContain('Title (EN): QA Engineer');
  });

  it('includes the summary for the current language', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('Experte en tests.');
  });

  it('includes linkedin and github when present', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('linkedin.com/in/alice');
    expect(text).toContain('github.com/alice');
  });

  it('omits linkedin and github lines when empty', () => {
    const cv = makeCV();
    cv.personalInfo.linkedin = '';
    cv.personalInfo.github = '';
    const text = serializeCVForATS(cv);
    expect(text).not.toContain('LinkedIn:');
    expect(text).not.toContain('GitHub:');
  });

  it('includes the skills section', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('== SKILLS ==');
    expect(text).toContain('[Test]: Playwright, Cypress');
  });

  it('includes the experience section with role, company and tech stack', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('== EXPERIENCE ==');
    expect(text).toContain('Lead QA at TechCorp');
    expect(text).toContain('Tech: Playwright, CI/CD');
    expect(text).toContain('- Automatisé les tests');
  });

  it('includes the education section', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('== EDUCATION ==');
    expect(text).toContain('Master Informatique — INSA Lyon (2016–2018)');
  });

  it('includes the languages section', () => {
    const text = serializeCVForATS(makeCV());
    expect(text).toContain('== LANGUAGES ==');
    expect(text).toContain('Français (Natif)');
  });

  it('omits tech stack line when techStack is empty', () => {
    const cv = makeCV();
    cv.experience[0].techStack = '';
    const text = serializeCVForATS(cv);
    expect(text).not.toContain('Tech:');
  });

  it('uses English content when currentLanguage is en', () => {
    const cv = { ...makeCV(), currentLanguage: 'en' as const };
    const text = serializeCVForATS(cv);
    expect(text).toContain('MSc Computer Science');
    expect(text).toContain('Automated tests');
  });
});

// ── withTimeout ───────────────────────────────────────────────────────────────

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the underlying promise value when it settles in time', async () => {
    const fast = Promise.resolve('done');
    const result = await withTimeout(fast);
    expect(result).toBe('done');
  });

  it('rejects with the upstream error when the promise rejects in time', async () => {
    const failing = Promise.reject(new Error('upstream error'));
    await expect(withTimeout(failing)).rejects.toThrow('upstream error');
  });

  it('rejects with a timeout error after the default 90 seconds', async () => {
    const neverResolves = new Promise<never>(() => {});
    const resultPromise = withTimeout(neverResolves);

    vi.advanceTimersByTime(90_001);

    await expect(resultPromise).rejects.toThrow('Timeout: the request took longer than 90s');
  });

  it('does not reject before 90 seconds have elapsed', async () => {
    let settled = false;
    const neverResolves = new Promise<never>(() => {});
    withTimeout(neverResolves).catch(() => { settled = true; });

    vi.advanceTimersByTime(89_999);
    await Promise.resolve();

    expect(settled).toBe(false);
  });

  it('honors a custom timeout in milliseconds', async () => {
    const neverResolves = new Promise<never>(() => {});
    const resultPromise = withTimeout(neverResolves, 5_000);

    vi.advanceTimersByTime(5_001);

    await expect(resultPromise).rejects.toThrow('Timeout: the request took longer than 5s');
  });
});

// expandSearchKeywords / qualifyScrapedJobs (job-search AI qualification) moved
// server-side to run via the `claude` CLI instead of Gemini/Claude API calls — see
// __tests__/server/scrapers.fake.test.ts (fake-provider behavior) and
// __tests__/server/scrapers.claudeCli.test.ts (CLI invocation + batch isolation).
