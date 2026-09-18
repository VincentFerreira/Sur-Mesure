import React from 'react';
import InsightCard from './InsightCard';
import { MissingKeywordRow } from '../../lib/insightsAts';

interface Props {
  rows: MissingKeywordRow[];
}

const MissingKeywordsCard: React.FC<Props> = ({ rows }) => {
  const maxCount = Math.max(1, ...rows.map((r) => r.missingCount));

  return (
    <InsightCard title="Keywords to add to your CV" testId="insight-card-keywords" fullWidth>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="insight-empty-keywords">
          No missing keyword on your scored jobs — nice work.
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.keyword} data-testid={`missing-keyword-${row.keyword}`}>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700 w-40 shrink-0 truncate">{row.keyword}</span>
                {row.isCritical && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">Critical</span>
                )}
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(row.missingCount / maxCount) * 100}%` }} />
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  missing in {row.missingCount} job{row.missingCount > 1 ? 's' : ''}
                  {row.partialCount > 0 ? ` · partial in ${row.partialCount}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </InsightCard>
  );
};

export default MissingKeywordsCard;
