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
  parse_cv: 'Parsing CV',
  analyze_ats: 'Analyse ATS',
  extract_job: 'Extraction offre',
  expand_keywords: 'Élargissement mots-clés',
  qualify: 'Qualification',
  search_all: 'Recherche web',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  if (typeof metadata.webSearchCount === 'number') parts.push(`${metadata.webSearchCount} recherche${metadata.webSearchCount > 1 ? 's' : ''}`);
  if (typeof metadata.webFetchCount === 'number') {
    const failures = typeof metadata.webFetchFailures === 'number' && metadata.webFetchFailures > 0 ? ` (${metadata.webFetchFailures} échec${metadata.webFetchFailures > 1 ? 's' : ''})` : '';
    parts.push(`${metadata.webFetchCount} fetch${metadata.webFetchCount > 1 ? 'es' : ''}${failures}`);
  }
  if (typeof metadata.numTurns === 'number') parts.push(`${metadata.numTurns} tours`);
  if (metadata.modelUsage && typeof metadata.modelUsage === 'object') {
    const modelCount = Object.keys(metadata.modelUsage as Record<string, unknown>).length;
    if (modelCount > 1) parts.push(`${modelCount} modèles`);
  }
  // qualify's batch size (server/scrapers/claudeCli.js's qualifyBatch) — a large scrape
  // run splits into several batched CLI calls, so knowing how many candidates each one
  // covered explains why some qualify rows cost/take more than others.
  if (typeof metadata.batchSize === 'number') parts.push(`${metadata.batchSize} candidat${metadata.batchSize > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatCount(n: number): string {
  return n.toLocaleString('fr-FR');
}

// Shared shape for the "Détail par provider" / "Détail par opération" breakdown
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
            <th className="text-left font-medium px-3 py-2">Nom</th>
            <th className="text-right font-medium px-3 py-2">Appels</th>
            <th className="text-right font-medium px-3 py-2">Tokens</th>
            <th className="text-right font-medium px-3 py-2">Coût</th>
            <th className="text-right font-medium px-3 py-2">Latence moy.</th>
            <th className="text-right font-medium px-3 py-2">Erreurs</th>
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
      .catch(() => setDetailError('Impossible de charger le détail de cet appel.'))
      .finally(() => setDetailLoading(false));
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="observability-page">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Observabilité</h1>
          <p className="text-xs text-slate-400 mt-0.5">Appels IA (Gemini, Claude, CLI Claude) — mise à jour automatique toutes les 5s</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-calls">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalCalls ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">appels</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-tokens">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalTokens?.toLocaleString('fr-FR') ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">tokens</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-cost">
            <p className="text-2xl font-bold text-slate-800">{stats ? formatCost(stats.totalCostUsd) : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">coût total</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-duration">
            <p className="text-2xl font-bold text-slate-800">{stats ? formatDuration(stats.avgDurationMs) : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">latence moyenne</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-errors">
            <p className="text-2xl font-bold text-slate-800">{stats ? `${Math.round(stats.errorRate * 100)}%` : '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">taux d'erreur</p>
          </div>
        </div>

        {stats && (stats.byOperation && Object.keys(stats.byOperation).length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="Détail par opération"
              testId="obs-breakdown-operation"
              rows={Object.entries(stats.byOperation)}
              labelFor={(key) => OPERATION_LABELS[key] ?? key}
            />
            <BreakdownTable
              title="Détail par provider"
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
            <option value="">Tous les providers</option>
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
            <option value="">Toutes les opérations</option>
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
            <option value="">Tous les statuts</option>
            <option value="success">Succès</option>
            <option value="error">Erreur</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {loading && calls.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : calls.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm text-slate-400" data-testid="obs-empty">Aucun appel IA enregistré pour l'instant.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm" data-testid="obs-calls-table">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="w-6"></th>
                  <th className="text-left font-medium px-3 py-2">Heure</th>
                  <th className="text-left font-medium px-3 py-2">Provider</th>
                  <th className="text-left font-medium px-3 py-2">Opération</th>
                  <th className="text-left font-medium px-3 py-2">Modèle</th>
                  <th className="text-right font-medium px-3 py-2">Durée</th>
                  <th className="text-right font-medium px-3 py-2">Tokens</th>
                  <th className="text-right font-medium px-3 py-2">Coût</th>
                  <th className="text-left font-medium px-3 py-2">Statut</th>
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
                    <td className="px-3 py-2 text-right text-slate-700">{call.totalTokens?.toLocaleString('fr-FR') ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatCost(call.costUsd)}</td>
                    <td className="px-3 py-2">
                      {call.status === 'success' ? (
                        <span className="text-emerald-600 text-xs font-medium">Succès</span>
                      ) : (
                        <span className="text-red-500 text-xs font-medium">Erreur</span>
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
