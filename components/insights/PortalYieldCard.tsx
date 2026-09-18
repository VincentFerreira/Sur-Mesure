import React from 'react';
import InsightCard from './InsightCard';
import BarRow from './BarRow';
import { PortalYieldResult } from '../../lib/insightsDiscovery';
import { portalLabel } from '../../components/scraper/scrapedJobMeta';
import { formatPercent } from '../../lib/insightsFormat';

interface Props {
  result: PortalYieldResult;
}

const PortalYieldCard: React.FC<Props> = ({ result }) => (
  <InsightCard title="Yield by portal" testId="insight-card-portals">
    {result.ranked.length === 0 && result.insufficient.length === 0 ? (
      <p className="text-sm text-slate-400" data-testid="insight-empty-portals">
        Not enough qualified jobs yet to compare portals.
      </p>
    ) : (
      <>
        <div className="space-y-3">
          {result.ranked.map((row) => (
            <div key={row.portal} data-testid={`portal-row-${row.portal}`}>
              <BarRow
                label={portalLabel(row.portal)}
                labelClassName="w-32"
                widthPercent={row.highRate * 100}
                barClassName="bg-emerald-400"
                valueText={`${formatPercent(row.highRate)} High`}
              />
              <p className="text-xs text-slate-400 mt-0.5 ml-[calc(8rem+0.75rem)]">
                {row.qualified} qualified · median {row.medianScore}
              </p>
            </div>
          ))}
        </div>
        {result.insufficient.length > 0 && (
          <p className="text-xs text-slate-400 mt-3" data-testid="portal-insufficient">
            Insufficient volume:{' '}
            {result.insufficient.map((p, i) => (
              <React.Fragment key={p.portal}>
                {i > 0 && ' · '}
                {portalLabel(p.portal)} ({p.qualified})
              </React.Fragment>
            ))}
            .
          </p>
        )}
      </>
    )}
  </InsightCard>
);

export default PortalYieldCard;
