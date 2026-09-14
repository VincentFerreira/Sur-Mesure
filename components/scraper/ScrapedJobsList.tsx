import React from 'react';
import { ScrapedJob, ScrapedJobFit } from '../../types';
import { FIT_GROUP_LABELS, FIT_GROUP_ORDER, UNQUALIFIED_GROUP_LABEL, formatRelativeDate, portalLabel } from './scrapedJobMeta';
import ScoreGauge from './ScoreGauge';
import SignalChip from './SignalChip';

interface Props {
  candidates: ScrapedJob[];
  onImport: (candidate: ScrapedJob) => void;
  onDismiss: (candidate: ScrapedJob) => void;
}

type GroupKey = ScrapedJobFit | 'unqualified';
interface Group {
  key: GroupKey;
  label: string;
  items: ScrapedJob[];
}

// Groups by the server-derived `fit` tier (a candidate with no `score`/`fit` yet —
// qualification never ran or failed for it — falls into a synthetic "unqualified"
// bucket) and sorts each group by score descending, so the best matches surface first
// within a tier.
function groupCandidates(candidates: ScrapedJob[]): Group[] {
  const buckets: Record<GroupKey, ScrapedJob[]> = { high: [], medium: [], low: [], unqualified: [] };
  for (const c of candidates) {
    if (c.fit && c.score !== undefined) buckets[c.fit].push(c);
    else buckets.unqualified.push(c);
  }
  for (const key of FIT_GROUP_ORDER) {
    buckets[key].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  const groups: Group[] = FIT_GROUP_ORDER.filter((fit) => buckets[fit].length > 0).map((fit) => ({
    key: fit,
    label: FIT_GROUP_LABELS[fit],
    items: buckets[fit],
  }));
  if (buckets.unqualified.length > 0) {
    groups.push({ key: 'unqualified', label: UNQUALIFIED_GROUP_LABEL, items: buckets.unqualified });
  }
  return groups;
}

const ScrapedJobsList: React.FC<Props> = ({ candidates, onImport, onDismiss }) => (
  <div>
    {groupCandidates(candidates).map((group) => (
      <section key={group.key} className="mb-6">
        <h3 className="text-xs font-medium text-slate-400 mb-2" data-testid={`scraped-jobs-group-${group.key}`}>
          {group.label} · {group.items.length}
        </h3>
        <div className="space-y-1">
          {group.items.map((candidate) => (
            <div
              key={candidate.id}
              data-testid={`scraped-job-row-${candidate.id}`}
              className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0"
            >
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
                  {candidate.isRemote ? ' · Télétravail' : ''} · {formatRelativeDate(candidate.postedDate)}
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
                    Importer
                  </button>
                  <button
                    onClick={() => onDismiss(candidate)}
                    data-testid={`dismiss-scraped-job-${candidate.id}`}
                    aria-label="Écarter"
                    className="text-slate-400 border border-slate-200 rounded-md p-1.5 hover:bg-slate-50 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
);

export default ScrapedJobsList;
