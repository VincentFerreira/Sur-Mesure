import React from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { AiCallDetail } from '../../types';

interface Props {
  detail: AiCallDetail | null;
  loading: boolean;
  error: string | null;
}

const PRE_CLASS = 'text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono text-slate-700';

function stepLabel(step: { tool: string; input?: Record<string, unknown> }): string {
  const detail = (step.input?.query as string) ?? (step.input?.url as string) ?? '';
  return detail ? `${step.tool} — ${detail}` : step.tool;
}

// Full detail for one call — fetched lazily on row click (see ObservabilityPage.tsx),
// never included in the polled list. Reuses the exact pending/done/failed icon
// pattern from pages/JobSearchPage.tsx's scrape-progress feed for the step trace, so
// this reads as "the same kind of thing," not a new visual language.
const AiCallDetailPanel: React.FC<Props> = ({ detail, loading, error }) => {
  if (loading) {
    return (
      <div className="flex justify-center py-6" data-testid="obs-call-detail">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-500 py-3" data-testid="obs-call-detail">
        {error}
      </p>
    );
  }
  if (!detail) return null;

  return (
    <div className="space-y-3 py-3" data-testid="obs-call-detail">
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">Prompt</p>
        {detail.prompt ? (
          <pre className={PRE_CLASS} data-testid="obs-call-detail-prompt">{detail.prompt}</pre>
        ) : (
          <p className="text-xs text-slate-400">No prompt logged.</p>
        )}
      </div>

      {detail.status === 'success' && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Response</p>
          {detail.responseText ? (
            <pre className={PRE_CLASS} data-testid="obs-call-detail-response">{detail.responseText}</pre>
          ) : (
            <p className="text-xs text-slate-400">No response logged.</p>
          )}
        </div>
      )}

      {detail.status === 'error' && (
        <div data-testid="obs-call-detail-error">
          <p className="text-xs font-semibold text-slate-500 mb-1">Error</p>
          <p className="text-xs text-red-500 mb-1.5">{detail.errorMessage}</p>
          {detail.errorDetail && (
            <>
              <p className="text-xs font-semibold text-slate-500 mb-1">Technical detail</p>
              <pre className={`${PRE_CLASS} text-red-600`} data-testid="obs-call-detail-error-detail">{detail.errorDetail}</pre>
            </>
          )}
        </div>
      )}

      {detail.stepTrace && detail.stepTrace.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Step trace</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1.5" data-testid="obs-call-detail-steps">
            {detail.stepTrace.map((step, i) => (
              'note' in step ? (
                <p key={i} className="text-xs text-slate-400 italic">{(step as unknown as { note: string }).note}</p>
              ) : (
                <div key={step.seq} className="text-xs text-slate-600" data-testid="obs-call-detail-step">
                  <div className="flex items-center gap-1.5">
                    {step.status === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" />}
                    {step.status === 'done' && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
                    {step.status === 'failed' && <X className="w-3 h-3 text-amber-500 shrink-0" />}
                    <span className="truncate">{stepLabel(step)}</span>
                  </div>
                  {step.resultSnippet && <p className="pl-4.5 text-[11px] text-slate-400 truncate">{step.resultSnippet}</p>}
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiCallDetailPanel;
