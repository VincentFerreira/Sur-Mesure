import { create } from 'zustand';
import { AiCall, AiCallOperation, AiCallProvider, AiCallStats, AiCallStatus } from '../types';
import { listAiCalls, fetchAiCallStats } from '../services/observabilityService';

const POLL_INTERVAL_MS = 5000;

interface ObservabilityState {
  calls: (AiCall & { rowId: number })[];
  stats: AiCallStats | null;
  loading: boolean;
  error: string | null;
  providerFilter: AiCallProvider | undefined;
  statusFilter: AiCallStatus | undefined;
  operationFilter: AiCallOperation | undefined;
  pollHandle: ReturnType<typeof setInterval> | null;
  fetchCalls: () => Promise<void>;
  fetchStats: () => Promise<void>;
  setProviderFilter: (provider: AiCallProvider | undefined) => void;
  setStatusFilter: (status: AiCallStatus | undefined) => void;
  setOperationFilter: (operation: AiCallOperation | undefined) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

// First polling store in the app (no existing precedent — every other store is
// fetch-on-mount/fetch-on-action only, see CLAUDE.md's Playwright/testing conventions
// and the rest of store/). Kept self-contained here rather than generalized into
// shared polling infra, since this is currently the only page that needs it.
export const useObservabilityStore = create<ObservabilityState>((set, get) => ({
  calls: [],
  stats: null,
  loading: false,
  error: null,
  providerFilter: undefined,
  statusFilter: undefined,
  operationFilter: undefined,
  pollHandle: null,

  fetchCalls: async () => {
    set({ loading: true, error: null });
    try {
      const { providerFilter, statusFilter, operationFilter } = get();
      const calls = await listAiCalls({ limit: 200, provider: providerFilter, status: statusFilter, operation: operationFilter });
      set({ calls, loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load AI calls. Is the server running?' });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await fetchAiCallStats();
      set({ stats });
    } catch {
      // Stats are a supplementary view on top of the call list — a failed fetch here
      // shouldn't blank out an otherwise-working page, so it's silent (the call list's
      // own error banner already covers "server unreachable").
    }
  },

  setProviderFilter: (provider) => {
    set({ providerFilter: provider });
    get().fetchCalls();
  },

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchCalls();
  },

  setOperationFilter: (operation) => {
    set({ operationFilter: operation });
    get().fetchCalls();
  },

  startPolling: () => {
    if (get().pollHandle) return;
    const handle = setInterval(() => {
      get().fetchCalls();
      get().fetchStats();
    }, POLL_INTERVAL_MS);
    set({ pollHandle: handle });
  },

  stopPolling: () => {
    const { pollHandle } = get();
    if (pollHandle) clearInterval(pollHandle);
    set({ pollHandle: null });
  },
}));
