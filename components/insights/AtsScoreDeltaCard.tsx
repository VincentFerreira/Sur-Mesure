import React from 'react';
import InsightCard from './InsightCard';
import { AtsScoreDelta, ATS_THRESHOLDS } from '../../lib/insightsAts';

interface Props {
  delta: AtsScoreDelta;
}

const AtsScoreDeltaCard: React.FC<Props> = ({ delta }) => (
  <InsightCard title="Average ATS score and potential gain" testId="insight-card-ats-score">
    {!delta.sufficient ? (
      <p className="text-sm text-slate-400" data-testid="insight-empty-ats-score">
        Not enough scores for a reliable average ({delta.scoredCount}/{ATS_THRESHOLDS.MIN_ATS_N}).
      </p>
    ) : (
      <>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-800" data-testid="ats-score-current">
            {delta.avgOverall}
          </span>
          <span className="text-slate-300">→</span>
          <span className="text-3xl font-bold text-emerald-600" data-testid="ats-score-estimated">
            {delta.avgEstimated}
          </span>
        </div>
        <div className="bg-slate-100 rounded-full h-3 overflow-hidden mt-3 flex">
          <div className="h-full bg-indigo-500" style={{ width: `${delta.avgOverall}%` }} />
          <div className="h-full bg-emerald-400" style={{ width: `${delta.gain}%` }} data-testid="ats-score-delta" />
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Estimated gain if you apply the recommendations: +{delta.gain} pts (across {delta.scoredCount} jobs).
        </p>
      </>
    )}
  </InsightCard>
);

export default AtsScoreDeltaCard;
