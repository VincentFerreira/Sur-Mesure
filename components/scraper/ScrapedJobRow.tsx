import React, { useCallback } from 'react';
import { ScrapedJob } from '../../types';
import { useMarkViewedOnVisible } from '../../hooks/useMarkViewedOnVisible';
import { formatRelativeDate, portalLabel } from './scrapedJobMeta';
import ScoreGauge from './ScoreGauge';
import SignalChip from './SignalChip';

interface Props {
  candidate: ScrapedJob;
  unseen: boolean;
  onImport: (candidate: ScrapedJob) => void;
  onDismiss: (candidate: ScrapedJob) => void;
  onMarkViewed: (id: string) => void;
}

// Extracted from ScrapedJobsList's former inline row so useMarkViewedOnVisible (a
// hook) can be called once per row — React's rules of hooks forbid calling one inside
// a .map() callback. Rendered markup for title/meta/chips/buttons is unchanged from
// before this extraction; the only visual addition is the leading gutter column below.
const ScrapedJobRow: React.FC<Props> = ({ candidate, unseen, onImport, onDismiss, onMarkViewed }) => {
  const handleVisible = useCallback(() => onMarkViewed(candidate.id), [candidate.id, onMarkViewed]);
  const ref = useMarkViewedOnVisible(handleVisible, unseen);

  return (
    <div
      ref={ref}
      data-testid={`scraped-job-row-${candidate.id}`}
      className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0"
    >
      {/* Gutter reserved unconditionally (dot only rendered when unseen) so the row
          never visually shifts when a candidate transitions from unseen to seen. */}
      <div className="w-2 shrink-0 pt-3.5 flex justify-center" data-testid={`scraped-job-unseen-dot-${candidate.id}`}>
        {unseen && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
      </div>
      {candidate.score !== undefined && candidate.fit ? (
        <ScoreGauge score={candidate.score} fit={candidate.fit} testId={`scraped-job-score-${candidate.id}`} />
      ) : (
        <div className="flex flex-col items-center w-[34px] shrink-0" data-testid={`scraped-job-score-${candidate.id}`}>
          <span className="text-2xl font-bold leading-none text-slate-300">—</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <a href={candidate.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-800 font-medium">
          {candidate.title}
        </a>
        <p className="text-xs text-slate-500 mt-0.5">
          {candidate.company} · {candidate.location || '—'}
          {candidate.isRemote ? ' · Remote' : ''} · {formatRelativeDate(candidate.postedDate)}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {(candidate.signals ?? []).map((signal, i) => (
            <SignalChip key={i} label={signal.label} polarity={signal.polarity} testId={`scraped-job-signal-${candidate.id}-${i}`} />
          ))}
          <SignalChip label={portalLabel(candidate.portal)} polarity="neutral" testId={`scraped-job-portal-${candidate.id}`} />
        </div>
      </div>
      {candidate.status === 'new' && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onImport(candidate)}
            data-testid={`import-scraped-job-${candidate.id}`}
            className="text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-md px-3 py-1.5 hover:bg-indigo-50"
          >
            Import
          </button>
          <button
            onClick={() => onDismiss(candidate)}
            data-testid={`dismiss-scraped-job-${candidate.id}`}
            aria-label="Dismiss"
            className="text-slate-400 border border-slate-200 rounded-md p-1.5 hover:bg-slate-50 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default ScrapedJobRow;
