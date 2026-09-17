import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useObservabilityStore } from '../store/observabilityStore';
import { AiCallProvider, AiCallStatus } from '../types';

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
  return parts.length > 0 ? parts.join(' · ') : null;
}

const ObservabilityPage: React.FC = () => {
  const {
    calls,
    stats,
    loading,
    error,
    providerFilter,
    statusFilter,
    fetchCalls,
    fetchStats,
    setProviderFilter,
    setStatusFilter,
    startPolling,
    stopPolling,
  } = useObservabilityStore();

  useEffect(() => {
    fetchCalls();
    fetchStats();
    startPolling();
    return stopPolling;
  }, [fetchCalls, fetchStats, startPolling, stopPolling]);

  return (
    <div className="h-full overflow-y-auto" data-testid="observability-page">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Observabilité</h1>
          <p className="text-xs text-slate-400 mt-0.5">Appels IA (Gemini, Claude, CLI Claude) — mise à jour automatique toutes les 5s</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-calls">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalCalls ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">appels</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5" data-testid="obs-stat-tokens">
            <p className="text-2xl font-bold text-slate-800">{stats?.totalTokens?.toLocaleString('fr-FR') ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">tokens</p>
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
                  return (
                  <tr key={call.id} className="border-t border-slate-100" data-testid="obs-call-row">
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
                        <span className="text-red-500 text-xs font-medium" title={call.errorMessage}>Erreur</span>
                      )}
                    </td>
                  </tr>
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
