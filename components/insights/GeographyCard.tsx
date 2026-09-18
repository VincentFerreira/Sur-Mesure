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

const departmentLabel = (department: string) => (department === 'unknown' ? 'Non précisé' : department);

const GeographyCard: React.FC<Props> = ({ geography, configuredLocations, showRemoteMismatchNudge }) => (
  <InsightCard title="Où sont les bonnes offres" testId="insight-card-geography" fullWidth>
    {!geography.sufficient ? (
      <p className="text-sm text-slate-400" data-testid="insight-empty-geography">
        Pas encore assez d'offres Fort pour conclure ({geography.highCount}/{DISCOVERY_THRESHOLDS.MIN_GEO_N}).
      </p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-500">Départements</p>
            {configuredLocations.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <span className="text-xs text-slate-400">Vos zones :</span>
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
          <p className="text-xs font-medium text-slate-500 mb-2">Télétravail (d'après le lieu)</p>
          <p className="text-3xl font-bold text-slate-800">{formatPercent(geography.remoteShare ?? 0)}</p>
          <p className="text-xs text-slate-400 mt-2">
            Déduit du champ lieu uniquement — une offre "2 jours de télétravail" annoncée en description n'est pas comptée.
          </p>
          {showRemoteMismatchNudge && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3" data-testid="geo-remote-hint">
              Les offres Fort sont à {formatPercent(geography.remoteShare ?? 0)} en télétravail, mais "remote" n'est pas dans vos modes de
              travail.{' '}
              <Link to="/preferences" className="font-medium underline">
                Ajuster mes préférences
              </Link>
            </p>
          )}
        </div>
      </div>
    )}
  </InsightCard>
);

export default GeographyCard;
