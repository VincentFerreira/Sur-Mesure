import React from 'react';
import InsightCard from './InsightCard';
import { FunnelResult, PIPELINE_STAGES, FUNNEL_THRESHOLDS } from '../../lib/insightsFunnel';
import { STATUS_LABELS_FR } from '../jobs/statusMeta';
import { formatPercent, formatDays } from '../../lib/insightsFormat';

interface Props {
  funnel: FunnelResult;
}

const FunnelCard: React.FC<Props> = ({ funnel }) => {
  const firstReached = funnel.stages[0]?.reachedCount ?? 0;

  return (
    <InsightCard title="Pipeline de conversion" testId="insight-card-funnel" fullWidth>
      {firstReached === 0 ? (
        <p className="text-sm text-slate-400" data-testid="insight-empty-funnel">
          Aucun poste suivi.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {funnel.stages.map((s, i) => (
              <React.Fragment key={s.stage}>
                <div className="flex items-center gap-3" data-testid={`funnel-stage-${s.stage}`}>
                  <span className="text-xs text-slate-600 w-36 shrink-0">{STATUS_LABELS_FR[s.stage]}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${(s.reachedCount / firstReached) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-8 text-right shrink-0">{s.reachedCount}</span>
                  <span className="text-xs text-slate-400 w-56 shrink-0" data-testid={`funnel-duration-${s.stage}`}>
                    {s.medianDurationDays !== undefined
                      ? `médiane ${formatDays(s.medianDurationDays)}`
                      : `— (${s.completedDurationCount}/${FUNNEL_THRESHOLDS.MIN_DURATION_N} transitions)`}
                    {s.inProgressCount > 0 &&
                      ` · ${s.inProgressCount} en cours (le plus ancien : ${formatDays(s.oldestInProgressDays ?? 0)})`}
                  </span>
                </div>
                {i < funnel.stages.length - 1 && (
                  <div className="pl-36" data-testid={`funnel-conversion-${s.stage}-${PIPELINE_STAGES[i + 1]}`}>
                    <span className="text-xs text-slate-400">
                      ↓ {s.conversionToNext !== undefined ? formatPercent(s.conversionToNext) : '—'}
                    </span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {(funnel.rejectedExits.length > 0 || funnel.archivedCount > 0) && (
            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400" data-testid="funnel-exits">
              {funnel.rejectedExits.length > 0 && (
                <p>
                  Sorties · Refusé au stade :{' '}
                  {funnel.rejectedExits.map((exit, i) => (
                    <React.Fragment key={exit.stage}>
                      {i > 0 && ' · '}
                      {STATUS_LABELS_FR[exit.stage]} {exit.count}
                    </React.Fragment>
                  ))}
                </p>
              )}
              {funnel.archivedCount > 0 && <p className="mt-1">Archivé {funnel.archivedCount}</p>}
            </div>
          )}
          <p className="text-xs text-slate-300 mt-3">
            — : moins de {FUNNEL_THRESHOLDS.MIN_FUNNEL_N} postes à cette étape, taux non affiché.
          </p>
        </>
      )}
    </InsightCard>
  );
};

export default FunnelCard;
