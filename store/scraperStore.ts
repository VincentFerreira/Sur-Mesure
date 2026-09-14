import { create } from 'zustand';
import { ScrapedJob, ScrapedJobStatus } from '../types';
import {
  dismissScrapedJob as dismissScrapedJobRequest,
  listScrapedJobs,
  markScrapedJobImported as markScrapedJobImportedRequest,
  deleteScrapedJob as deleteScrapedJobRequest,
  runScrape as runScrapeRequest,
  setScrapedJobQualification as setScrapedJobQualificationRequest,
  QualifyResult,
  RunScrapeResult,
} from '../services/scraperService';
import { ApiError } from '../services/apiClient';

interface ScraperState {
  candidates: ScrapedJob[];
  loading: boolean;
  running: boolean;
  error: string | null;
  lastRunReport: RunScrapeResult['portalReport'] | null;
  fetchCandidates: (status?: ScrapedJobStatus) => Promise<void>;
  runScrape: (jobTitles?: string[]) => Promise<RunScrapeResult>;
  dismissCandidate: (id: string) => Promise<ScrapedJob>;
  importCandidate: (id: string, jobId: string) => Promise<ScrapedJob>;
  setCandidateQualification: (id: string, qualification: QualifyResult) => Promise<ScrapedJob>;
  removeCandidate: (id: string) => Promise<void>;
}

export const useScraperStore = create<ScraperState>((set, get) => ({
  candidates: [],
  loading: false,
  running: false,
  error: null,
  lastRunReport: null,

  fetchCandidates: async (status) => {
    set({ loading: true, error: null });
    try {
      const candidates = await listScrapedJobs(status);
      set({ candidates, loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load scraped jobs. Is the server running?' });
    }
  },

  // Separate `running` flag from `loading`: a scrape run hits an external API and can
  // take several seconds, and the button needs its own spinner independent of the
  // initial list fetch.
  runScrape: async (jobTitles) => {
    set({ running: true, error: null });
    try {
      const result = await runScrapeRequest(jobTitles);
      set({
        candidates: [...result.created, ...get().candidates],
        running: false,
        lastRunReport: result.portalReport,
      });
      return result;
    } catch (err) {
      set({ running: false, error: err instanceof ApiError ? err.message : 'Unable to run scrape.' });
      throw err;
    }
  },

  dismissCandidate: async (id) => {
    const updated = await dismissScrapedJobRequest(id);
    set({ candidates: get().candidates.map((c) => (c.id === id ? updated : c)) });
    return updated;
  },

  // Called after JobForm's onSubmit successfully creates a real Job from this
  // candidate — flips it to `imported` so it drops out of the default "New" view.
  importCandidate: async (id, jobId) => {
    const updated = await markScrapedJobImportedRequest(id, jobId);
    set({ candidates: get().candidates.map((c) => (c.id === id ? updated : c)) });
    return updated;
  },

  // Applies the AI qualification pass's verdict for one candidate — 'low' fit also
  // dismisses it in the same request (see setScrapedJobQualification in
  // scraperService.ts).
  setCandidateQualification: async (id, qualification) => {
    const updated = await setScrapedJobQualificationRequest(id, qualification);
    set({ candidates: get().candidates.map((c) => (c.id === id ? updated : c)) });
    return updated;
  },

  removeCandidate: async (id) => {
    await deleteScrapedJobRequest(id);
    set({ candidates: get().candidates.filter((c) => c.id !== id) });
  },
}));
