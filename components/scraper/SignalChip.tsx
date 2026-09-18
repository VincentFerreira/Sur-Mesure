import React from 'react';
import { ScrapedSignalPolarity } from '../../types';

interface Props {
  label: string;
  polarity: ScrapedSignalPolarity;
  testId?: string;
}

const POLARITY_CLASSES: Record<ScrapedSignalPolarity, string> = {
  positive: 'bg-emerald-50 text-emerald-700',
  negative: 'bg-amber-50 text-amber-700',
  neutral: 'bg-slate-100 text-slate-500',
};

const SignalChip: React.FC<Props> = ({ label, polarity, testId }) => (
  <span data-testid={testId} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POLARITY_CLASSES[polarity]}`}>
    {label}
  </span>
);

export default SignalChip;
