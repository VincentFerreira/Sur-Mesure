import { describe, it, expect } from 'vitest';
import { tallySignalThemes } from '../../lib/insightsSignals';
import { ScrapedJob } from '../../types';

type SignalCandidate = Pick<ScrapedJob, 'id' | 'score' | 'signals'>;

function candidate(id: string, score: number | undefined, signals: SignalCandidate['signals']): SignalCandidate {
  return { id, score, signals };
}

describe('tallySignalThemes', () => {
  it('maps "Sur site uniquement" to onsite, not remote (table order)', () => {
    const { rows } = tallySignalThemes(
      [candidate('1', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }])],
      'negative'
    );
    expect(rows.map((r) => r.themeId)).toEqual(['onsite']);
  });

  it('maps "100% présentiel" to onsite and "Télétravail 3j"/"Hybride" to remote', () => {
    const { rows } = tallySignalThemes(
      [
        candidate('1', 80, [{ label: '100% présentiel', polarity: 'negative' }]),
        candidate('2', 70, [{ label: 'Télétravail 3j', polarity: 'positive' }]),
        candidate('3', 70, [{ label: 'Hybride', polarity: 'positive' }]),
      ],
      'negative'
    );
    expect(rows.map((r) => r.themeId)).toEqual(['onsite']);

    const positive = tallySignalThemes(
      [
        candidate('2', 70, [{ label: 'Télétravail 3j', polarity: 'positive' }]),
        candidate('3', 70, [{ label: 'Hybride', polarity: 'positive' }]),
      ],
      'positive'
    );
    expect(positive.rows.map((r) => r.themeId)).toEqual(['remote']);
    expect(positive.rows[0].count).toBe(2);
  });

  it('maps ESN/régie, seniority, and CV-match labels to their themes', () => {
    const { rows } = tallySignalThemes(
      [
        candidate('1', 80, [{ label: 'ESN/consulting - possible régie', polarity: 'negative' }]),
        candidate('2', 80, [{ label: 'Séniorité floue', polarity: 'negative' }]),
      ],
      'negative'
    );
    expect(rows.map((r) => r.themeId).sort()).toEqual(['esn', 'seniority']);

    const positive = tallySignalThemes([candidate('3', 90, [{ label: 'CV aligné', polarity: 'positive' }])], 'positive');
    expect(positive.rows.map((r) => r.themeId)).toEqual(['cvMatch']);
  });

  it('falls back a bare city name to "autre"', () => {
    const { rows } = tallySignalThemes([candidate('1', 80, [{ label: 'Paris', polarity: 'positive' }])], 'positive');
    expect(rows.map((r) => r.themeId)).toEqual(['autre']);
  });

  it('never aggregates neutral signals', () => {
    const { rows, qualifiedCount } = tallySignalThemes(
      [candidate('1', 80, [{ label: 'Paris', polarity: 'neutral' }])],
      'neutral'
    );
    expect(rows).toEqual([]);
    expect(qualifiedCount).toBe(1);
  });

  it('excludes unqualified candidates (no score) from both numerator and denominator', () => {
    const { rows, qualifiedCount } = tallySignalThemes(
      [
        candidate('1', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
        candidate('2', undefined, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
      ],
      'negative'
    );
    expect(qualifiedCount).toBe(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].share).toBe(1);
  });

  it('counts a theme at most once per candidate even with repeated signals', () => {
    const { rows } = tallySignalThemes(
      [
        candidate('1', 80, [
          { label: 'Remote', polarity: 'negative' },
          { label: 'Télétravail', polarity: 'negative' },
        ]),
      ],
      'negative'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].themeId).toBe('remote');
    expect(rows[0].count).toBe(1);
  });

  it('always returns "autre" last even when it outranks the top-limit themes', () => {
    const candidates: SignalCandidate[] = [
      // 5 candidates raising an "autre" concern (a city name isn't one, so use an
      // off-table phrase instead) vs 1 each for two real themes.
      ...Array.from({ length: 5 }, (_, i) => candidate(`other-${i}`, 80, [{ label: 'Une raison inédite', polarity: 'negative' as const }])),
      candidate('onsite-1', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
      candidate('esn-1', 80, [{ label: 'Régie', polarity: 'negative' }]),
    ];
    const { rows } = tallySignalThemes(candidates, 'negative', 2);
    expect(rows).toHaveLength(3); // top 2 + autre, even though autre has the highest count
    expect(rows[rows.length - 1].themeId).toBe('autre');
    expect(rows[rows.length - 1].count).toBe(5);
  });

  it('caps samples at 3 distinct raw labels, most frequent first', () => {
    const candidates: SignalCandidate[] = [
      candidate('1', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
      candidate('2', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
      candidate('3', 80, [{ label: 'Présentiel obligatoire', polarity: 'negative' }]),
      candidate('4', 80, [{ label: 'Pas de télétravail', polarity: 'negative' }]),
      candidate('5', 80, [{ label: '100% présentiel', polarity: 'negative' }]),
    ];
    const { rows } = tallySignalThemes(candidates, 'negative');
    const onsite = rows.find((r) => r.themeId === 'onsite')!;
    expect(onsite.samples).toHaveLength(3);
    expect(onsite.samples[0]).toBe('Sur site uniquement');
  });

  it('sorts by count descending, then theme id ascending for determinism', () => {
    const candidates: SignalCandidate[] = [
      candidate('1', 80, [{ label: 'Sur site uniquement', polarity: 'negative' }]),
      candidate('2', 80, [{ label: 'Régie', polarity: 'negative' }]),
    ];
    const { rows } = tallySignalThemes(candidates, 'negative');
    expect(rows.map((r) => r.themeId)).toEqual(['esn', 'onsite']);
  });

  it('returns empty rows and qualifiedCount 0 when there are no candidates', () => {
    const { rows, qualifiedCount } = tallySignalThemes([], 'negative');
    expect(rows).toEqual([]);
    expect(qualifiedCount).toBe(0);
  });
});
