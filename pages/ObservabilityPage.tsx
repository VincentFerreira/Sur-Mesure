import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useObservabilityStore } from '../store/observabilityStore';
import { AiCallDetail, AiCallOperation, AiCallProvider, AiCallStatsBreakdown, AiCallStatus } from '../types';
import { fetchAiCallDetail } from '../services/observabilityService';
import AiCallDetailPanel from '../components/observability/AiCallDetailPanel';

const PROVIDER_LABELS: Record<AiCallProvider, string> = {
  gemini: 'Gemini',
  claude: 'Claude (SDK)',
  claude_cli: 'Claude (CLI)',
  fake: 'Fake',
};

const OPERATION_LABELS: Record<string, string> = {
  parse_cv: 'CV parsing',
  analyze_ats: 'ATS analysis',
  extract_job: 'Job extraction',
  expand_keywords: 'Keyword expansion',
  qualify: 'Qualification',
  search_all: 'Web search',
  generate_application_text: 'Application text',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCost(usd: number | undefined): string {
  return usd === undefined ? '—' : `$${usd.toFixed(2)}`;
}

// search_all's flat prompt/completion token count undercounts real usage — a call can
// span multiple models (e.g. a cheap one executing WebSearch, a pricier one
// orchestrating) and the token count above only reflects the top-level turn, not cache
// reads or the other model's usage (found via live testing — see
// server/scrapers/claudeCli.js's runClaudeStreaming). This summarizes the metadata
// that actually explains the call's real cost instead.
function formatCallMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const parts: string[] = [];
  if (typeof metadata.webSearchCount === 'number') parts.push(`${metadata.webSearchCount} search${metadata.webSearchCount > 1 ? 'es' : ''}`);
  if (typeof metadata.webFetchCount === 'number') {
    const failures = typeof metadata.webFetchFailures === 'number' && metadata.webFetchFailures > 0 ? ` (${metadata.webFetchFailures} failure${metadata.webFetchFailures > 1 ? 's' : ''})` : '';
    parts.push(`${metadata.webFetchCount} fetch${metadata.webFetchCount > 1 ? 'es' : ''}${failures}`);
  }
  if (typeof metadata.numTurns === 'number') parts.push(`${metadata.numTurns} turn${metadata.numTurns > 1 ? 's' : ''}`);
  if (metadata.modelUsage && typeof metadata.modelUsage === 'object') {
    const modelCount = Object.keys(metadata.modelUsage as Record<string, unknown>).length;
    if (modelCount > 1) parts.push(`${modelCount} models`);
  }
  // qualify's batch size (server/scrapers/claudeCli.js's qualifyBatch) — a large scrape
  // run splits into several batched CLI calls, so knowing how many candidates each one
  // covered explains why some qualify rows cost/take more than others.
  if (typeof metadata.batchSize === 'number') parts.push(`${metadata.batchSize} candidate${metadata.batchSize > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

// Shared shape for the "Breakdown by provider" / "Breakdown by operation" breakdown
// tables below — both read straight off AiCallStats.byProvider/byOperation, which the
// server already aggregates (server/observabilityStore.js's getStats), so this is
// pure rendering, no client-side computation.
const BreakdownTable: React.FC<{
  title: string;
  testId: string;
  rows: [string, AiCallStatsBreakdown][];
  labelFor: (key: string) => string;
}> = ({ title, testId, rows, labelFor }) => {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <p className="text-sm font-semibold text-slate-600 px-3 pt-3 pb-2">{title}</p>
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="bg-slate-50 text-slate-500 text-xs">
          <tr>
            <th className="text-left font-medium px-3 py-2">Name</th>
            <th className="text-right font-medium px-3 py-2">Calls</th>
            <th className="text-right font-medium px-3 py-2">Tokens</th>
            <th className="text-right font-medium px-3 py-2">Cost</th>
            <th className="text-right font-medium px-3 py-2">Avg latency</th>
            <th className="text-right font-medium px-3 py-2">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort(([, a], [, b]) => b.calls - a.calls)
            .map(([key, row]) => (
              <tr key={key} className="border-t border-slate-100" data-testid={`${testId}-row`}>
                <td className="px-3 py-2 text-slate-700">{labelFor(key)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCount(row.calls)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCount(row.tokens)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCost(row.costUsd)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatDuration(row.avgDurationMs)}</td>
                <td className="px-3 py-2 text-right">
                  {row.errors > 0 ? (
                    <span className="text-red-500">{row.errors} ({Math.round((row.errors / row.calls) * 100)}%)</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

const ObservabilityPage: React.FC = () => {
  const {
    calls,
    stats,
    loading,
    error,
    providerFilter,
    statusFilter,
    operationFilter,
    fetchCalls,
    fetchStats,
    setProviderFilter,
    setStatusFilter,
    setOperationFilter,
    startPolling,
    stopPolling,
  } = useObservabilityStore();

  useEffect(() => {
    fetchCalls();
    fetchStats();
    startPolling();
    return stopPolling;
  }, [fetchCalls, fetchStats, startPolling, stopPolling]);

  // Detail is a one-off fetch-on-click, not polled/shared state (a logged call is
  // immutable once written) — kept as page-local state rather than growing the store's
  // surface for a value nothing else needs.
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    if (expandedCallId === id) {
      setExpandedCallId(null);
      return;
    }
    setExpandedCallId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetchAiCallDetail(id)
      .then((d) => setDetail(d))
      .catch(() => setDetailError('Failed to load this call\'s detail.'))
      .finally(() => setDetailLoading(false));
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="observability-page">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Observability</h1>
          <p className="text-xs text-slate-400 mt-0.5">AI calls (Gemini, Claude, Claude CLI) — auto-refreshes every 5s</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-calls">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalCalls ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">calls</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-tokens">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalTokens?.toLocaleString('en-US') ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">tokens</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-cost">
            <p className="text-2xl font-bold text-slate-800">{stats ? formatCost(stats.totalCostUsd) : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">total cost</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-duration">
            <p className="text-2xl font-bold text-slate-800">{stats ? formatDuration(stats.avgDurationMs) : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">avg latency</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-errors">
            <p className="text-2xl font-bold text-slate-800">{stats ? `${Math.round(stats.errorRate * 100)}%` : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">error rate</p>
          </div>
        </div>

        {stats && (stats.byOperation && Object.keys(stats.byOperation).length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="Breakdown by operation"
              testId="obs-breakdown-operation"
              rows={Object.entries(stats.byOperation)}
              labelFor={(key) => OPERATION_LABELS[key] ?? key}
            />
            <BreakdownTable
              title="Breakdown by provider"
              testId="obs-breakdown-provider"
              rows={Object.entries(stats.byProvider)}
              labelFor={(key) => PROVIDER_LABELS[key as AiCallProvider] ?? key}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <select
            data-testid="obs-filter-provider"
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white"
            value={providerFilter ?? ''}
            onChange={(e) => setProviderFilter((e.target.value || undefined) as AiCallProvider | undefined)}
          >
            <option value="">All providers</option>
            {(Object.keys(PROVIDER_LABELS) as AiCallProvider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
          <select
            data-testid="obs-filter-operation"
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white"
            value={operationFilter ?? ''}
            onChange={(e) => setOperationFilter((e.target.value || undefined) as AiCallOperation | undefined)}
          >
            <option value="">All operations</option>
            {Object.entries(OPERATION_LABELS).map(([op, label]) => (
              <option key={op} value={op}>{label}</option>
            ))}
          </select>
          <select
            data-testid="obs-filter-status"
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 bg-white"
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter((e.target.value || undefined) as AiCallStatus | undefined)}
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {loading && calls.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : calls.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm text-slate-400" data-testid="obs-empty">No AI calls logged yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm" data-testid="obs-calls-table">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="w-6"></th>
                  <th className="text-left font-medium px-3 py-2">Time</th>
                  <th className="text-left font-medium px-3 py-2">Provider</th>
                  <th className="text-left font-medium px-3 py-2">Operation</th>
                  <th className="text-left font-medium px-3 py-2">Model</th>
                  <th className="text-right font-medium px-3 py-2">Duration</th>
                  <th className="text-right font-medium px-3 py-2">Tokens</th>
                  <th className="text-right font-medium px-3 py-2">Cost</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const metadataSummary = formatCallMetadata(call.metadata);
                  const isExpanded = expandedCallId === call.id;
                  return (
                  <React.Fragment key={call.id}>
                  <tr
                    className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                    data-testid="obs-call-row"
                    onClick={() => toggleRow(call.id)}
                  >
                    <td className="px-2 text-slate-400">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatTime(call.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{PROVIDER_LABELS[call.provider] ?? call.provider}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {OPERATION_LABELS[call.operation] ?? call.operation}
                      {/* search_all's token count undercounts real usage (multi-model
                          calls) — see formatCallMetadata; this is the honest breakdown. */}
                      {metadataSummary && <p className="text-[11px] text-slate-400 mt-0.5" data-testid="obs-call-metadata">{metadataSummary}</p>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{call.model ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatDuration(call.durationMs)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{call.totalTokens?.toLocaleString('en-US') ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatCost(call.costUsd)}</td>
                    <td className="px-3 py-2">
                      {call.status === 'success' ? (
                        <span className="text-emerald-600 text-xs font-medium">Success</span>
                      ) : (
                        <span className="text-red-500 text-xs font-medium">Error</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-slate-100 bg-slate-50/50">
                      <td></td>
                      <td colSpan={8} className="px-3">
                        <AiCallDetailPanel detail={detail} loading={detailLoading} error={detailError} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ObservabilityPage;
