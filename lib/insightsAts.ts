import { Job } from '../types';
import { Theme, matchTheme, OTHER_THEME_ID } from './insightsThemes';
import { mean } from './insightsFormat';

const MIN_ATS_N = 3;
const TOP_KEYWORDS = 8;
const MIN_FORMATTING_ISSUES = 2;
const MIN_FORMATTING_ISSUE_RATE = 0.5;

type ScoredJob = Job & { ats: NonNullable<Job['ats']> };

function scoredJobs(jobs: Job[]): ScoredJob[] {
  return jobs.filter((j): j is ScoredJob => Boolean(j.ats));
}

export interface AtsScoreDelta {
  sufficient: boolean;
  scoredCount: number;
  avgOverall?: number;
  avgEstimated?: number;
  gain?: number;
}

// Mean, not median: the "gain" is a *paired* quantity (estimated minus current, per
// job), and mean(estimated) - mean(overall) equals mean(gain) exactly, which keeps the
// headline arithmetic consistent with itself. Below MIN_ATS_N, refuses to average.
export function atsScoreDelta(jobs: Job[]): AtsScoreDelta {
  const scored = scoredJobs(jobs);
  if (scored.length < MIN_ATS_N) {
    return { sufficient: false, scoredCount: scored.length };
  }
  const avgOverall = Math.round(mean(scored.map((j) => j.ats.analysis.overallScore)) as number);
  const avgEstimated = Math.round(mean(scored.map((j) => j.ats.analysis.estimatedNewScore)) as number);
  return { sufficient: true, scoredCount: scored.length, avgOverall, avgEstimated, gain: avgEstimated - avgOverall };
}

export interface MissingKeywordRow {
  keyword: string; // most frequent original casing
  missingCount: number;
  partialCount: number;
  isCritical: boolean;
}

// Case-insensitive aggregation key (the previous implementation counted "TypeScript"
// and "typescript" as two separate keywords) — the displayed label is whichever
// original casing occurred most often for that key.
export function topMissingKeywords(jobs: Job[], limit = TOP_KEYWORDS): MissingKeywordRow[] {
  const scored = scoredJobs(jobs);
  const byKey = new Map<
    string,
    { missingCount: number; partialCount: number; isCritical: boolean; casing: Map<string, number> }
  >();

  for (const job of scored) {
    const keywords = [...job.ats.analysis.criticalKeywords, ...job.ats.analysis.importantKeywords];
    for (const kw of keywords) {
      if (kw.status !== 'missing' && kw.status !== 'partial') continue;
      const key = kw.keyword.trim().toLowerCase();
      if (!key) continue;
      const entry = byKey.get(key) ?? { missingCount: 0, partialCount: 0, isCritical: false, casing: new Map<string, number>() };
      if (kw.status === 'missing') entry.missingCount += 1;
      else entry.partialCount += 1;
      if (kw.importance === 'critical') entry.isCritical = true;
      entry.casing.set(kw.keyword, (entry.casing.get(kw.keyword) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()]
    .map((entry) => ({
      keyword: [...entry.casing.entries()].sort((a, b) => b[1] - a[1])[0][0],
      missingCount: entry.missingCount,
      partialCount: entry.partialCount,
      isCritical: entry.isCritical,
    }))
    .sort((a, b) => b.missingCount - a.missingCount || Number(b.isCritical) - Number(a.isCritical) || a.keyword.localeCompare(b.keyword))
    .slice(0, limit);
}

// The ATS prompt (services/aiService.ts) explicitly enumerates six formatting concepts
// it must cover — contact info, dates, achievements, action verbs, keyword stuffing,
// bullets/formatting — so unlike ScrapedSignal.label (genuinely free text), this
// vocabulary is semi-closed: the LLM varies phrasing but not the underlying concepts.
// Order matters: 'dates' must precede 'bullets' since "consistent date formats"
// contains the substring "format".
export const FORMATTING_THEMES: Theme[] = [
  { id: 'contact', label: 'Coordonnées complètes', patterns: ['contact', 'coordonnees', 'email', 'telephone', 'linkedin'] },
  { id: 'dates', label: 'Format des dates', patterns: ['date'] },
  {
    id: 'achievements',
    label: 'Résultats chiffrés',
    patterns: ['achievement', 'measurable', 'quantif', 'metric', 'chiffre', 'resultat', 'realisation'],
  },
  { id: 'actionVerbs', label: "Verbes d'action", patterns: ['action verb', 'verbe', 'action'] },
  { id: 'stuffing', label: 'Bourrage de mots-clés', patterns: ['stuffing', 'bourrage', 'keyword density', 'repetition'] },
  { id: 'bullets', label: 'Puces / mise en forme', patterns: ['bullet', 'puce', 'liste', 'format'] },
];

const FORMATTING_THEME_LABELS: Record<string, string> = Object.fromEntries(FORMATTING_THEMES.map((t) => [t.id, t.label]));
FORMATTING_THEME_LABELS[OTHER_THEME_ID] = 'Autre';

export interface FormattingThemeRow {
  themeId: string;
  label: string;
  fail: number;
  warning: number;
  total: number;
}

// Only surfaces a theme when it's a *recurring* problem — a single stray warning
// across a dozen analyses isn't a structural CV issue worth reporting.
export function recurringFormattingIssues(jobs: Job[], limit = 5): FormattingThemeRow[] {
  const scored = scoredJobs(jobs);
  const byTheme = new Map<string, { fail: number; warning: number; total: number }>();

  for (const job of scored) {
    for (const check of job.ats.analysis.formattingChecks) {
      const themeId = matchTheme(check.label, FORMATTING_THEMES);
      const entry = byTheme.get(themeId) ?? { fail: 0, warning: 0, total: 0 };
      entry.total += 1;
      if (check.status === 'fail') entry.fail += 1;
      if (check.status === 'warning') entry.warning += 1;
      byTheme.set(themeId, entry);
    }
  }

  return [...byTheme.entries()]
    .map(([themeId, counts]) => ({ themeId, label: FORMATTING_THEME_LABELS[themeId] ?? themeId, ...counts }))
    .filter((row) => {
      const issues = row.fail + row.warning;
      return issues >= MIN_FORMATTING_ISSUES && issues / row.total >= MIN_FORMATTING_ISSUE_RATE;
    })
    .sort((a, b) => b.fail - a.fail || b.fail + b.warning - (a.fail + a.warning) || a.themeId.localeCompare(b.themeId))
    .slice(0, limit);
}

export const ATS_THRESHOLDS = { MIN_ATS_N, MIN_FORMATTING_ISSUES, MIN_FORMATTING_ISSUE_RATE };
