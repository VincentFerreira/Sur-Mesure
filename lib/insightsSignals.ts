import { ScrapedJob, ScrapedSignalPolarity } from '../types';
import { Theme, matchTheme, OTHER_THEME_ID } from './insightsThemes';

// Order is a disambiguation rule (see insightsThemes.ts matchTheme): 'onsite' must
// precede 'remote' so a label like "Sur site uniquement, pas de télétravail" resolves
// to onsite rather than remote via the "teletravail" substring; 'contract' precedes
// 'seniority' so "CDI senior" doesn't get swallowed by 'esn'/'stack' first, etc. Don't
// reorder without re-checking the disambiguation cases in insightsSignals.test.ts.
export const SIGNAL_THEMES: Theme[] = [
  {
    id: 'onsite',
    label: 'Onsite required',
    patterns: ['sur site', 'presentiel', 'sur place', 'no remote', 'pas de teletravail', 'sans teletravail', '100 presentiel', 'onsite'],
  },
  { id: 'remote', label: 'Remote', patterns: ['teletravail', 'remote', 'distanciel', 'hybride', 'hybrid'] },
  { id: 'esn', label: 'Staffing agency', patterns: ['esn', 'regie', 'ssii', 'consulting', 'prestataire', 'prestation', 'cabinet'] },
  { id: 'contract', label: 'Contract type', patterns: ['cdi', 'cdd', 'freelance', 'alternance', 'stage', 'interim', 'portage', 'contrat'] },
  {
    id: 'seniority',
    label: 'Seniority',
    patterns: [
      'seniorite',
      'senior',
      'junior',
      'lead',
      'ans d experience',
      'experience requise',
      'niveau d experience',
      'confirme',
      'debutant',
    ],
  },
  { id: 'salary', label: 'Salary', patterns: ['salaire', 'remuneration', 'tjm', 'package', 'budget', 'keur', 'k euros'] },
  {
    id: 'stack',
    label: 'Tech stack',
    patterns: ['stack', 'techno', 'outil', 'framework', 'langage', 'competences techniques', 'automatisation', 'certification'],
  },
  { id: 'cvMatch', label: 'CV match', patterns: ['cv', 'profil aligne', 'ecart profil', 'parcours'] },
  { id: 'location', label: 'Location', patterns: ['localisation', 'location', 'deplacement', 'mobilite', 'trajet', 'region', 'zone', 'hors zone'] },
  { id: 'scope', label: 'Title / scope', patterns: ['intitule', 'title', 'perimetre', 'metier', 'fonction', 'hors cible', 'poste adjacent'] },
  { id: 'language', label: 'Language', patterns: ['anglais', 'english', 'bilingue', 'allemand', 'langue'] },
  {
    id: 'freshness',
    label: 'Job freshness',
    patterns: ['offre ancienne', 'perimee', 'date de publication', 'publiee il y a'],
  },
];

const SIGNAL_THEME_LABELS: Record<string, string> = Object.fromEntries(SIGNAL_THEMES.map((t) => [t.id, t.label]));
SIGNAL_THEME_LABELS[OTHER_THEME_ID] = 'Other';

const MAX_SAMPLES = 3;

export interface ThemeTally {
  themeId: string;
  label: string;
  count: number;
  share: number;
  samples: string[];
}

export interface SignalThemesResult {
  rows: ThemeTally[];
  qualifiedCount: number;
}

type SignalCandidate = Pick<ScrapedJob, 'id' | 'score' | 'signals'>;

// Aggregates how often each signal theme appears across *qualified* candidates
// (score !== undefined — unqualified candidates are excluded from both numerator and
// denominator, never treated as 0), restricted to one polarity at a time (positive and
// negative signals are never summed together — a theme id alone doesn't say whether it
// helped or hurt a given candidate). `neutral` signals are never aggregated: they're
// factual trivia (a city name), not evaluative — the LLM prompt puts things like
// "Paris" there, and counting them would produce a "top blocker: Paris" nonsense row.
export function tallySignalThemes(candidates: SignalCandidate[], polarity: ScrapedSignalPolarity, limit = 6): SignalThemesResult {
  const qualified = candidates.filter((c) => c.score !== undefined);
  const qualifiedCount = qualified.length;

  if (polarity === 'neutral' || qualifiedCount === 0) {
    return { rows: [], qualifiedCount };
  }

  const counts = new Map<string, number>();
  const samples = new Map<string, Map<string, number>>();

  for (const candidate of qualified) {
    const themesSeen = new Set<string>();
    for (const signal of candidate.signals ?? []) {
      if (signal.polarity !== polarity) continue;
      const themeId = matchTheme(signal.label, SIGNAL_THEMES);
      themesSeen.add(themeId);
      const sampleCounts = samples.get(themeId) ?? new Map<string, number>();
      sampleCounts.set(signal.label, (sampleCounts.get(signal.label) ?? 0) + 1);
      samples.set(themeId, sampleCounts);
    }
    // Count each theme at most once per candidate — `count` measures how many
    // distinct candidates raised this concern, not how many times the LLM repeated it.
    for (const themeId of themesSeen) {
      counts.set(themeId, (counts.get(themeId) ?? 0) + 1);
    }
  }

  const rows: ThemeTally[] = [...counts.entries()]
    .map(([themeId, count]) => ({
      themeId,
      label: SIGNAL_THEME_LABELS[themeId] ?? themeId,
      count,
      share: count / qualifiedCount,
      samples: [...(samples.get(themeId) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SAMPLES)
        .map(([label]) => label),
    }))
    .sort((a, b) => b.count - a.count || a.themeId.localeCompare(b.themeId));

  const otherRow = rows.find((r) => r.themeId === OTHER_THEME_ID);
  const ranked = rows.filter((r) => r.themeId !== OTHER_THEME_ID).slice(0, limit);
  // 'Autre' is always shown last if non-empty, even if it would otherwise rank inside
  // the top-`limit` — a large "Autre" bucket is a signal the theme table needs
  // enriching, and it must stay visible rather than silently winning a top slot.
  return { rows: otherRow ? [...ranked, otherRow] : ranked, qualifiedCount };
}
