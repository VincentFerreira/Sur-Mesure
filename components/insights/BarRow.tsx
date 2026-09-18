import React from 'react';

interface Props {
  label: string;
  widthPercent: number; // 0-100, already computed by the caller (normalized to max or to a share — the caller decides which is meaningful)
  valueText: string;
  barClassName?: string; // fill color, defaults to indigo
  labelClassName?: string; // width/typography of the label column, callers with longer French labels widen this
  testId?: string;
  title?: string; // native tooltip, used to surface raw sample labels behind a theme
}

// Shared hand-rolled bar idiom for the Analyse page — this repo has no charting
// library, everything is a div track + a filled div, sized via inline style.
const BarRow: React.FC<Props> = ({
  label,
  widthPercent,
  valueText,
  barClassName = 'bg-indigo-400',
  labelClassName = 'w-32',
  testId,
  title,
}) => (
  <div className="flex items-center gap-3" data-testid={testId} title={title}>
    <span className={`text-xs text-slate-500 shrink-0 truncate ${labelClassName}`}>{label}</span>
    <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barClassName}`} style={{ width: `${Math.max(0, Math.min(100, widthPercent))}%` }} />
    </div>
    <span className="text-xs font-semibold text-slate-600 text-right shrink-0">{valueText}</span>
  </div>
);

export default BarRow;
