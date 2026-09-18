import React from 'react';
import { ScrapedJob, ScrapedJobFit } from '../../types';
import { FIT_GROUP_LABELS, FIT_GROUP_ORDER, UNQUALIFIED_GROUP_LABEL } from './scrapedJobMeta';
import ScrapedJobRow from './ScrapedJobRow';

interface Props {
  candidates: ScrapedJob[];
  onImport: (candidate: ScrapedJob) => void;
  onDismiss: (candidate: ScrapedJob) => void;
  onMarkViewed: (id: string) => void;
}

type GroupKey = ScrapedJobFit | 'unqualified';
interface Group {
  key: GroupKey;
  label: string;
  items: ScrapedJob[];
}

const fitRank = (c: ScrapedJob): number =>
  c.fit && c.score !== undefined ? FIT_GROUP_ORDER.indexOf(c.fit) : FIT_GROUP_ORDER.length;

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

// "Tri : inédites en premier, puis le tri actuel (fit, puis récence)." The unseen
// partition keeps the exact tier-grouping/header/testid logic above, applied
// unchanged. The seen ("déjà vues") partition is rendered as a single flat block,
// same fit-rank-then-score ordering but WITHOUT per-tier sub-headers — giving it its
// own headers would produce duplicate data-testid="scraped-jobs-group-high" (etc.)
// whenever both partitions have candidates in the same tier, which breaks
// Playwright's getByTestId (strict-mode multi-match). A single "N déjà vues"
// separator is also exactly what the spec's wording asks for ("le bloc des inédites
// et le reste" — singular).
const ScrapedJobsList: React.FC<Props> = ({ candidates, onImport, onDismiss, onMarkViewed }) => {
  const unseen = candidates.filter((c) => !c.viewedAt);
  const seen = candidates.filter((c) => c.viewedAt);
  const seenSorted = [...seen].sort((a, b) => fitRank(a) - fitRank(b) || (b.score ?? -1) - (a.score ?? -1));

  return (
    <div>
      {groupCandidates(unseen).map((group) => (
        <section key={group.key} className="mb-6">
          <h3 className="text-xs font-medium text-slate-400 mb-2" data-testid={`scraped-jobs-group-${group.key}`}>
            {group.label} · {group.items.length}
          </h3>
          <div className="space-y-1">
            {group.items.map((candidate) => (
              <ScrapedJobRow
                key={candidate.id}
                candidate={candidate}
                unseen
                onImport={onImport}
                onDismiss={onDismiss}
                onMarkViewed={onMarkViewed}
              />
            ))}
          </div>
        </section>
      ))}

      {seen.length > 0 && (
        <section className="mb-6">
          <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-2" data-testid="scraped-jobs-seen-separator">
            <span className="flex-1 border-t border-slate-200" />
            {seen.length} déjà vues
            <span className="flex-1 border-t border-slate-200" />
          </h3>
          <div className="space-y-1">
            {seenSorted.map((candidate) => (
              <ScrapedJobRow
                key={candidate.id}
                candidate={candidate}
                unseen={false}
                onImport={onImport}
                onDismiss={onDismiss}
                onMarkViewed={onMarkViewed}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default ScrapedJobsList;
