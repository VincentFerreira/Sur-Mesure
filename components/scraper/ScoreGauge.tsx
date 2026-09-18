import React from 'react';
import { ScrapedJobFit } from '../../types';

interface Props {
  score: number;
  fit: ScrapedJobFit;
  testId?: string;
}

// Same color-bucketing idiom as components/matches/ScoreBadge.tsx (a separate,
// unrelated feature — not reused directly since that one renders a "/100" pill, this
// one renders a bare number + bar), but keyed off the server-derived `fit` rather than
// re-thresholding `score` client-side, so the color always agrees with the tier this
// candidate is grouped under.
const TIER_CLASSES: Record<ScrapedJobFit, { text: string; bar: string; track: string }> = {
  high: { text: 'text-emerald-600', bar: 'bg-emerald-500', track: 'bg-emerald-100' },
  medium: { text: 'text-amber-600', bar: 'bg-amber-500', track: 'bg-amber-100' },
  low: { text: 'text-slate-400', bar: 'bg-slate-400', track: 'bg-slate-200' },
};

const ScoreGauge: React.FC<Props> = ({ score, fit, testId }) => {
  const { text, bar, track } = TIER_CLASSES[fit];
  const width = Math.max(0, Math.min(100, score));
  return (
    <div className="flex flex-col items-center w-[34px] shrink-0" data-testid={testId}>
      <span className={`text-2xl font-bold leading-none ${text}`}>{score}</span>
      <div className={`mt-1.5 h-1 w-[34px] rounded-full overflow-hidden ${track}`}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

export default ScoreGauge;
