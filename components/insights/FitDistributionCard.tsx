import React from 'react';
import InsightCard from './InsightCard';
import BarRow from './BarRow';
import { FitDistribution, ReviewConversion, DISCOVERY_THRESHOLDS } from '../../lib/insightsDiscovery';
import { FIT_GROUP_LABELS, UNQUALIFIED_GROUP_LABEL } from '../../components/scraper/scrapedJobMeta';
import { formatPercent } from '../../lib/insightsFormat';

interface Props {
  distribution: FitDistribution;
  reviews: ReviewConversion[]; // high, medium
}

const TIER_COLORS: Record<'high' | 'medium' | 'low' | 'unqualified', string> = {
  high: 'bg-emerald-400',
  medium: 'bg-amber-400',
  low: 'bg-slate-400',
  unqualified: 'bg-slate-200',
};

const FitDistributionCard: React.FC<Props> = ({ distribution, reviews }) => {
  const maxCount = Math.max(1, distribution.high, distribution.medium, distribution.low, distribution.unqualified);
  const rows: { key: 'high' | 'medium' | 'low' | 'unqualified'; label: string; count: number }[] = [
    { key: 'high', label: FIT_GROUP_LABELS.high, count: distribution.high },
    { key: 'medium', label: FIT_GROUP_LABELS.medium, count: distribution.medium },
    { key: 'low', label: FIT_GROUP_LABELS.low, count: distribution.low },
    { key: 'unqualified', label: UNQUALIFIED_GROUP_LABEL, count: distribution.unqualified },
  ];

  return (
    <InsightCard title="Qualité des offres trouvées" testId="insight-card-fit">
      {distribution.total === 0 ? (
        <p className="text-sm text-slate-400" data-testid="insight-empty-fit">
          Aucune offre découverte pour l'instant.
        </p>
      ) : (
        <>
          <div className="space-y-2.5">
            {rows.map((row) => (
              <BarRow
                key={row.key}
                testId={`fit-row-${row.key}`}
                label={row.label}
                labelClassName="w-24"
                widthPercent={(row.count / maxCount) * 100}
                barClassName={TIER_COLORS[row.key]}
                valueText={String(row.count)}
              />
            ))}
          </div>
          {distribution.unqualified > 0 && (
            <p className="text-xs text-slate-400 mt-3">
              {distribution.unqualified} offres non évaluées (découvertes avant la mise en place de la notation).
            </p>
          )}
          {reviews.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2">Taux d'import après revue</p>
              <div className="space-y-1.5">
                {reviews.map((review) => (
                  <div key={review.tier} className="flex items-center justify-between text-xs" data-testid={`review-conversion-${review.tier}`}>
                    <span className="text-slate-500">{FIT_GROUP_LABELS[review.tier]}</span>
                    <span className="font-medium text-slate-700">
                      {review.importRate !== undefined
                        ? formatPercent(review.importRate)
                        : `— (${review.reviewedCount}/${DISCOVERY_THRESHOLDS.MIN_REVIEWED} revues)`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">Hors offres écartées automatiquement (fit faible).</p>
            </div>
          )}
        </>
      )}
    </InsightCard>
  );
};

export default FitDistributionCard;
