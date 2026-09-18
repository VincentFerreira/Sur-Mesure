import { describe, it, expect } from 'vitest';
import { atsScoreDelta, topMissingKeywords, recurringFormattingIssues } from '../../lib/insightsAts';
import { Job, ATSAnalysisResult, ATSKeyword, ATSFormattingCheck } from '../../types';

function keyword(overrides: Partial<ATSKeyword> & { keyword: string }): ATSKeyword {
  return { status: 'missing', frequency: 0, importance: 'important', analysis: '', ...overrides };
}

function analysis(overrides: Partial<ATSAnalysisResult> = {}): ATSAnalysisResult {
  return {
    overallScore: 60,
    estimatedNewScore: 60,
    criticalKeywords: [],
    importantKeywords: [],
    formattingChecks: [],
    recommendations: [],
    summary: '',
    ...overrides,
  };
}

function scoredJob(id: string, overrides: Partial<ATSAnalysisResult> = {}): Job {
  return {
    id,
    company: 'Acme',
    title: 'QA',
    status: 'lead',
    priority: 2,
    descriptionRaw: '',
    keywords: [],
    ats: { analysis: analysis(overrides), provider: 'fake', model: 'fake', promptVersion: 'v1', jobDescriptionHash: 'x' },
    submitted: false,
    events: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function unscoredJob(id: string): Job {
  return {
    id,
    company: 'Acme',
    title: 'QA',
    status: 'lead',
    priority: 2,
    descriptionRaw: '',
    keywords: [],
    submitted: false,
    events: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('atsScoreDelta', () => {
  it('is insufficient below the minimum scored-job count', () => {
    const result = atsScoreDelta([scoredJob('1', { overallScore: 50, estimatedNewScore: 70 })]);
    expect(result.sufficient).toBe(false);
    expect(result.scoredCount).toBe(1);
  });

  it('computes the mean overall/estimated score and their gain once above the threshold', () => {
    const jobs = [
      scoredJob('1', { overallScore: 50, estimatedNewScore: 70 }),
      scoredJob('2', { overallScore: 60, estimatedNewScore: 80 }),
      scoredJob('3', { overallScore: 70, estimatedNewScore: 90 }),
    ];
    const result = atsScoreDelta(jobs);
    expect(result.sufficient).toBe(true);
    expect(result.avgOverall).toBe(60);
    expect(result.avgEstimated).toBe(80);
    expect(result.gain).toBe(20);
  });

  it('ignores jobs with no ats result', () => {
    const jobs = [scoredJob('1'), scoredJob('2'), scoredJob('3'), unscoredJob('4')];
    const result = atsScoreDelta(jobs);
    expect(result.scoredCount).toBe(3);
  });
});

describe('topMissingKeywords', () => {
  it('merges keywords that differ only by casing, keeping the most frequent casing', () => {
    const jobs = [
      scoredJob('1', { criticalKeywords: [keyword({ keyword: 'TypeScript', status: 'missing' })] }),
      scoredJob('2', { criticalKeywords: [keyword({ keyword: 'typescript', status: 'missing' })] }),
      scoredJob('3', { criticalKeywords: [keyword({ keyword: 'TypeScript', status: 'missing' })] }),
    ];
    const rows = topMissingKeywords(jobs);
    expect(rows).toHaveLength(1);
    expect(rows[0].keyword).toBe('TypeScript');
    expect(rows[0].missingCount).toBe(3);
  });

  it('tracks missing and partial counts separately', () => {
    const jobs = [
      scoredJob('1', { importantKeywords: [keyword({ keyword: 'Docker', status: 'missing' })] }),
      scoredJob('2', { importantKeywords: [keyword({ keyword: 'Docker', status: 'partial' })] }),
      scoredJob('3', { importantKeywords: [keyword({ keyword: 'Docker', status: 'present' })] }),
    ];
    const rows = topMissingKeywords(jobs);
    expect(rows[0]).toMatchObject({ keyword: 'Docker', missingCount: 1, partialCount: 1 });
  });

  it('flags a keyword as critical when any occurrence was critical', () => {
    const jobs = [
      scoredJob('1', { importantKeywords: [keyword({ keyword: 'AWS', status: 'missing', importance: 'important' })] }),
      scoredJob('2', { criticalKeywords: [keyword({ keyword: 'AWS', status: 'missing', importance: 'critical' })] }),
    ];
    const rows = topMissingKeywords(jobs);
    expect(rows[0].isCritical).toBe(true);
  });

  it('sorts by missingCount descending and caps at the given limit', () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      scoredJob(`job-${i}`, {
        criticalKeywords: [keyword({ keyword: 'A', status: 'missing' }), keyword({ keyword: 'B', status: 'missing' })],
      })
    ).concat(scoredJob('extra', { criticalKeywords: [keyword({ keyword: 'C', status: 'missing' })] }));
    const rows = topMissingKeywords(jobs, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.keyword)).toEqual(['A', 'B']);
  });
});

function formattingCheck(overrides: Partial<ATSFormattingCheck> & { label: string }): ATSFormattingCheck {
  return { status: 'fail', ...overrides };
}

describe('recurringFormattingIssues', () => {
  it('maps "Consistent date formats" to dates, not bullets', () => {
    const jobs = Array.from({ length: 2 }, (_, i) =>
      scoredJob(`j-${i}`, { formattingChecks: [formattingCheck({ label: 'Consistent date formats', status: 'fail' })] })
    );
    const rows = recurringFormattingIssues(jobs);
    expect(rows.map((r) => r.themeId)).toEqual(['dates']);
  });

  it('maps "Bullet points usage" to bullets', () => {
    const jobs = Array.from({ length: 2 }, (_, i) =>
      scoredJob(`j-${i}`, { formattingChecks: [formattingCheck({ label: 'Bullet points usage', status: 'warning' })] })
    );
    const rows = recurringFormattingIssues(jobs);
    expect(rows.map((r) => r.themeId)).toEqual(['bullets']);
  });

  it('filters out a theme with fewer than 2 issues', () => {
    const jobs = [
      scoredJob('1', { formattingChecks: [formattingCheck({ label: 'Use of action verbs', status: 'warning' })] }),
      ...Array.from({ length: 9 }, (_, i) => scoredJob(`pass-${i}`, { formattingChecks: [formattingCheck({ label: 'Use of action verbs', status: 'pass' })] })),
    ];
    const rows = recurringFormattingIssues(jobs);
    expect(rows).toEqual([]);
  });

  it('filters out a theme whose issue rate is below 50%', () => {
    const jobs = [
      ...Array.from({ length: 2 }, (_, i) => scoredJob(`fail-${i}`, { formattingChecks: [formattingCheck({ label: 'Bullet points usage', status: 'fail' })] })),
      ...Array.from({ length: 8 }, (_, i) => scoredJob(`pass-${i}`, { formattingChecks: [formattingCheck({ label: 'Bullet points usage', status: 'pass' })] })),
    ];
    const rows = recurringFormattingIssues(jobs);
    expect(rows).toEqual([]);
  });

  it('includes pass results in the total count', () => {
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) => scoredJob(`fail-${i}`, { formattingChecks: [formattingCheck({ label: 'Bullet points usage', status: 'fail' })] })),
      scoredJob('pass-1', { formattingChecks: [formattingCheck({ label: 'Bullet points usage', status: 'pass' })] }),
    ];
    const rows = recurringFormattingIssues(jobs);
    expect(rows[0].total).toBe(4);
  });
});
