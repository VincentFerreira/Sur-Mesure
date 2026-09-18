// Generic free-text label normalizer + theme matcher, shared by insightsSignals.ts
// (ScrapedSignal.label, genuinely free LLM text) and insightsAts.ts (ATSFormattingCheck
// labels, which are far more constrained — see that file's FORMATTING_THEMES comment).
//
// What this approach gets wrong, on purpose accepted rather than hidden:
// - An off-table phrasing silently lands in the 'autre' bucket. Mitigation: callers must
//   always render 'autre' last with a handful of its raw sample labels rather than
//   dropping it — a large 'autre' bucket is the signal that the theme table needs a new
//   entry, and it stays visible instead of vanishing.
// - Substring matching over-captures (e.g. a pattern "lead" also matches "Lead QA").
//   Accepted: themes are broad buckets for orientation, not precise classification.
// - One label maps to exactly one theme (first match in table order wins) — a label
//   mixing two concepts ("Sur site à Paris") only contributes to the first one matched.
// - This is polarity-blind: matching only looks at the label text, never at
//   ScrapedSignal.polarity. Callers MUST aggregate positive and negative signals
//   separately and never sum them — the theme id alone doesn't tell you whether it was
//   a pro or a con for that particular candidate.

export interface Theme {
  id: string;
  label: string;
  patterns: string[];
}

export const OTHER_THEME_ID = 'autre';

const DIACRITICS_RANGE = /[̀-ͯ]/g;

export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(DIACRITICS_RANGE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// First-match-wins against `themes`, in array order — order is a disambiguation rule,
// not incidental (e.g. a theme for "sur site" must precede one for "remote" so
// "sur site, pas de télétravail" doesn't fall into the remote bucket via a shared word).
export function matchTheme(label: string, themes: Theme[]): string {
  const normalized = normalizeLabel(label);
  for (const theme of themes) {
    if (theme.patterns.some((pattern) => normalized.includes(pattern))) return theme.id;
  }
  return OTHER_THEME_ID;
}
