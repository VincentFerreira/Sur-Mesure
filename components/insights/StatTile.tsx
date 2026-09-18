import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  value: string | number;
  label: string;
  to: string;
  testId: string;
}

// Same visual idiom as JobsPage's KPI tiles (text-2xl font-bold value + a muted
// caption), but these navigate cross-page (Discovery/Jobs) rather than filtering
// in place, so a Link rather than a filter-setting button.
const StatTile: React.FC<Props> = ({ value, label, to, testId }) => (
  <Link
    to={to}
    data-testid={testId}
    className="block bg-white border border-slate-200 rounded-xl p-3.5 hover:border-indigo-200 transition-colors"
  >
    <p className="text-2xl font-bold text-slate-800">{value}</p>
    <p className="text-xs text-slate-400 mt-0.5">{label}</p>
  </Link>
);

export default StatTile;
