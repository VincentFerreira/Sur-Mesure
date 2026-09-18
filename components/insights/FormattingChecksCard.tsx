import React from 'react';
import InsightCard from './InsightCard';
import { FormattingThemeRow } from '../../lib/insightsAts';

interface Props {
  rows: FormattingThemeRow[];
}

const FormattingChecksCard: React.FC<Props> = ({ rows }) => (
  <InsightCard title="Problèmes de forme récurrents" testId="insight-card-formatting">
    {rows.length === 0 ? (
      <p className="text-sm text-slate-400" data-testid="insight-empty-formatting">
        Aucun problème de forme récurrent détecté.
      </p>
    ) : (
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.themeId} className="flex items-center gap-2 text-sm" data-testid={`formatting-row-${row.themeId}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${row.fail > 0 ? 'bg-red-400' : 'bg-amber-400'}`} />
            <span className="text-slate-700 font-medium">{row.label}</span>
            <span className="text-xs text-slate-400">
              échoue sur {row.fail + row.warning} des {row.total} analyses
            </span>
          </li>
        ))}
      </ul>
    )}
  </InsightCard>
);

export default FormattingChecksCard;
