import React from 'react';
import InsightCard from './InsightCard';
import BarRow from './BarRow';
import { SignalThemesResult } from '../../lib/insightsSignals';
import { formatPercent } from '../../lib/insightsFormat';
import { OTHER_THEME_ID } from '../../lib/insightsThemes';

interface Props {
  title: string;
  testId: string;
  emptyTestId: string;
  polarity: 'negative' | 'positive';
  result: SignalThemesResult;
  barClassName: string;
}

const SignalThemesCard: React.FC<Props> = ({ title, testId, emptyTestId, polarity, result, barClassName }) => (
  <InsightCard title={title} testId={testId}>
    {result.rows.length === 0 ? (
      <p className="text-sm text-slate-400" data-testid={emptyTestId}>
        Not enough qualified jobs yet to surface a trend.
      </p>
    ) : (
      <div className="space-y-2.5">
        {result.rows.map((row) => {
          const isOther = row.themeId === OTHER_THEME_ID;
          return (
            <div key={row.themeId}>
              <BarRow
                testId={`signal-theme-${polarity}-${row.themeId}`}
                label={row.label}
                labelClassName="w-40"
                widthPercent={row.share * 100}
                barClassName={isOther ? 'bg-slate-300' : barClassName}
                valueText={`${row.count} (${formatPercent(row.share)})`}
                title={row.samples.join(' · ')}
              />
              {isOther && row.samples.length > 0 && (
                <p className="text-xs text-slate-400 mt-0.5 ml-[calc(10rem+0.75rem)]">e.g. {row.samples.join(' · ')}</p>
              )}
            </div>
          );
        })}
      </div>
    )}
  </InsightCard>
);

export default SignalThemesCard;
