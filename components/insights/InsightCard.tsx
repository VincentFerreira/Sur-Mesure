import React from 'react';

interface Props {
  title: string;
  testId: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}

// Shared card shell for the Analyse page — matches this app's existing convention
// (bg-white border border-slate-200 rounded-xl p-4 + an uppercase eyebrow label), used
// by e.g. InsightsPage's old score-distribution/missing-keywords cards.
const InsightCard: React.FC<Props> = ({ title, testId, fullWidth, children }) => (
  <div className={`bg-white border border-slate-200 rounded-xl p-4 ${fullWidth ? 'col-span-full' : ''}`} data-testid={testId}>
    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">{title}</p>
    {children}
  </div>
);

export default InsightCard;
