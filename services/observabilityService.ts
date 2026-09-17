import { AiCall, AiCallDetail, AiCallOperation, AiCallProvider, AiCallStats, AiCallStatus, AiCallStep } from '../types';
import { apiFetch } from './apiClient';

export interface LogAiCallInput {
  provider: AiCallProvider;
  operation: AiCallOperation;
  model?: string;
  durationMs: number;
  status: AiCallStatus;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  metadata?: Record<string, unknown>;
  prompt?: string;
  responseText?: string;
  errorDetail?: string;
  stepTrace?: AiCallStep[];
}

// Fire-and-forget: called right after a client-side Gemini/Claude SDK call
// (services/aiService.ts) finishes, success or error. Must never throw or delay the
// caller — a failure to log a call must not be mistaken for a failure of the AI call
// itself, so errors are swallowed here, not propagated.
export function logAiCall(record: LogAiCallInput): void {
  apiFetch<AiCall>('/observability/calls', { method: 'POST', body: JSON.stringify(record) }, 'Failed to log AI call').catch((err) => {
    console.warn('[observability] failed to log AI call', err);
  });
}

export interface ListAiCallsParams {
  limit?: number;
  sinceRowId?: number;
  provider?: AiCallProvider;
  status?: AiCallStatus;
  operation?: AiCallOperation;
}

export async function listAiCalls(params: ListAiCallsParams = {}): Promise<(AiCall & { rowId: number })[]> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.sinceRowId !== undefined) qs.set('sinceRowId', String(params.sinceRowId));
  if (params.provider) qs.set('provider', params.provider);
  if (params.status) qs.set('status', params.status);
  if (params.operation) qs.set('operation', params.operation);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<(AiCall & { rowId: number })[]>(`/observability/calls${suffix}`, undefined, 'Failed to list AI calls');
}

export async function fetchAiCallStats(rangeStart?: string): Promise<AiCallStats> {
  const qs = rangeStart ? `?rangeStart=${encodeURIComponent(rangeStart)}` : '';
  return apiFetch<AiCallStats>(`/observability/stats${qs}`, undefined, 'Failed to fetch AI call stats');
}

// Fetched lazily, only when a user opens a call's row in the Observability page — the
// polled list (listAiCalls above) never includes prompt/responseText/errorDetail/
// stepTrace (see server/observabilityStore.js's LIST_COLUMNS).
export async function fetchAiCallDetail(id: string): Promise<AiCallDetail> {
  return apiFetch<AiCallDetail>(`/observability/calls/${encodeURIComponent(id)}`, undefined, 'Failed to fetch AI call detail');
}
