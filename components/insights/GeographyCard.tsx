import React from 'react';
import { Link } from 'react-router-dom';
import InsightCard from './InsightCard';
import BarRow from './BarRow';
import { GeographyResult, DISCOVERY_THRESHOLDS } from '../../lib/insightsDiscovery';
import { formatPercent } from '../../lib/insightsFormat';

interface Props {
  geography: GeographyResult;
  configuredLocations: string[];
  showRemoteMismatchNudge: boolean;
}

const departmentLabel = (department: string) => (department === 'unknown' ? 'Unspecified' : department);

const GeographyCard: React.FC<Props> = ({ geography, configuredLocations, showRemoteMismatchNudge }) => (
  <InsightCard title="Where the good jobs are" testId="insight-card-geography" fullWidth>
    {!geography.sufficient ? (
      <p className="text-sm text-slate-400" data-testid="insight-empty-geography">
        Not enough high-fit jobs yet to conclude ({geography.highCount}/{DISCOVERY_THRESHOLDS.MIN_GEO_N}).
      </p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-500">Departments</p>
            {configuredLocations.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <span className="text-xs text-slate-400">Your areas:</span>
                {configuredLocations.map((loc) => (
                  <span key={loc} className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {loc}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {geography.departments.map((d) => (
              <BarRow
                key={d.department}
                testId={`geo-department-${d.department}`}
                label={departmentLabel(d.department)}
                labelClassName="w-24"
                widthPercent={(d.count / geography.highCount) * 100}
                barClassName="bg-indigo-400"
                valueText={String(d.count)}
              />
            ))}
          </div>
        </div>
        <div data-testid="geo-remote-share">
          <p className="text-xs font-medium text-slate-500 mb-2">Remote (based on location)</p>
          <p className="text-3xl font-bold text-slate-800">{formatPercent(geography.remoteShare ?? 0)}</p>
          <p className="text-xs text-slate-400 mt-2">
            Derived from the location field only — a job mentioning "2 days remote" in its description isn't counted.
          </p>
          {showRemoteMismatchNudge && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3" data-testid="geo-remote-hint">
              High-fit jobs are {formatPercent(geography.remoteShare ?? 0)} remote, but "remote" isn't in your work
              modes.{' '}
              <Link to="/preferences" className="font-medium underline">
                Adjust my preferences
              </Link>
            </p>
          )}
        </div>
      </div>
    )}
  </InsightCard>
);

export default GeographyCard;
