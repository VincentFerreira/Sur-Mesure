import { describe, it, expect } from 'vitest';
import { normalizeLabel, matchTheme, OTHER_THEME_ID, Theme } from '../../lib/insightsThemes';

describe('normalizeLabel', () => {
  it('strips accents', () => {
    expect(normalizeLabel('régie')).toBe('regie');
  });

  it('lowercases and collapses punctuation into single spaces', () => {
    expect(normalizeLabel('ESN/consulting - possible régie')).toBe('esn consulting possible regie');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeLabel('Sur   site   uniquement')).toBe('sur site uniquement');
  });

  it('trims leading/trailing separators', () => {
    expect(normalizeLabel('  100% présentiel!  ')).toBe('100 presentiel');
  });

  it('returns an empty string for an empty input', () => {
    expect(normalizeLabel('')).toBe('');
  });
});

describe('matchTheme', () => {
  const themes: Theme[] = [
    { id: 'onsite', label: 'Présentiel imposé', patterns: ['sur site', 'presentiel'] },
    { id: 'remote', label: 'Télétravail', patterns: ['teletravail', 'remote'] },
  ];

  it('returns the first matching theme in table order', () => {
    // "sur site" matches onsite even though nothing here matches remote.
    expect(matchTheme('Sur site uniquement', themes)).toBe('onsite');
  });

  it('resolves ambiguity by table order when two themes could match', () => {
    const ambiguous: Theme[] = [
      { id: 'a', label: 'A', patterns: ['lead'] },
      { id: 'b', label: 'B', patterns: ['qa'] },
    ];
    expect(matchTheme('Lead QA', ambiguous)).toBe('a');
  });

  it('falls back to the "autre" theme id when nothing matches', () => {
    expect(matchTheme('Paris', themes)).toBe(OTHER_THEME_ID);
  });

  it('is case-insensitive', () => {
    expect(matchTheme('REMOTE', themes)).toBe('remote');
  });

  it('is accent-insensitive', () => {
    expect(matchTheme('100% PRÉSENTIEL', themes)).toBe('onsite');
  });
});
