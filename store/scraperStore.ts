import { create } from 'zustand';
import { ScrapedJob, ScrapedJobStatus, ScraperProgressEvent } from '../types';
import {
  dismissScrapedJob as dismissScrapedJobRequest,
  setDismissReason as setDismissReasonRequest,
  listScrapedJobs,
  markScrapedJobImported as markScrapedJobImportedRequest,
  deleteScrapedJob as deleteScrapedJobRequest,
  runScrape as runScrapeRequest,
  getRunProgress,
  setScrapedJobQualification as setScrapedJobQualificationRequest,
  markScrapedJobsViewed as markScrapedJobsViewedRequest,
  QualifyResult,
  RunScrapeResult,
} from '../services/scraperService';
import { ApiError } from '../services/apiClient';

// Deliberately shorter than observabilityStore.ts's 5s dashboard poll — this one polls
// only while a run is actually in flight (started/stopped around runScrape below, not
// on mount), and the whole point is for it to feel live during a call that can take
// several minutes, so a snappier interval is worth the extra requests here.
const PROGRESS_POLL_INTERVAL_MS = 1500;
const PROGRESS_EVENTS_KEPT = 12;

interface ScraperState {
  candidates: ScrapedJob[];
  loading: boolean;
  running: boolean;
  error: string | null;
  lastRunReport: RunScrapeResult['portalReport'] | null;
  lastRunCreated: ScrapedJob[] | null;
  // The most recently dismissed candidate, so JobSearchPage can offer a one-off
  // "pourquoi ?" toast right after — deliberately just a single slot, not a queue:
  // dismissing again (or explicitly closing it) simply replaces/clears it, which is
  // an acceptable trade-off for a purely optional, low-stakes follow-up.
  lastDismissed: { id: string; title: string } | null;
  // Live feedback for the currently in-flight run (see server/scraperProgress.js) —
  // only the most recent PROGRESS_EVENTS_KEPT are kept, this is a transient "what's
  // happening right now" feed, not a log the user needs to scroll back through.
  progressEvents: ScraperProgressEvent[];
  progressPollHandle: ReturnType<typeof setInterval> | null;
  progressLastSeq: number;
  fetchCandidates: (status?: ScrapedJobStatus) => Promise<void>;
  runScrape: (jobTitles?: string[]) => Promise<RunScrapeResult>;
  fetchProgress: () => Promise<void>;
  startProgressPolling: () => void;
  stopProgressPolling: () => void;
  dismissCandidate: (id: string) => Promise<ScrapedJob>;
  setDismissReason: (id: string, reason: string) => Promise<ScrapedJob>;
  clearLastDismissed: () => void;
  importCandidate: (id: string, jobId: string) => Promise<ScrapedJob>;
  setCandidateQualification: (id: string, qualification: QualifyResult) => Promise<ScrapedJob>;
  removeCandidate: (id: string) => Promise<void>;
  markCandidatesViewed: (ids: string[]) => Promise<void>;
}

export const useScraperStore = create<ScraperState>((set, get) => ({
  candidates: [],
  loading: false,
  running: false,
  error: null,
  lastRunReport: null,
  lastRunCreated: null,
  lastDismissed: null,
  progressEvents: [],
  progressPollHandle: null,
  progressLastSeq: 0,

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
  //
  // Polls GET /scraper/run/progress for the whole duration of the request below (not
  // just conceptually "while running" — actually started/stopped around the awaited
  // call) so the UI can show what claudeCli.searchAll is doing live instead of a
  // static spinner; stopped in a `finally` so a failed run still clears the feed.
  runScrape: async (jobTitles) => {
    set({ running: true, error: null, progressEvents: [], progressLastSeq: 0 });
    get().startProgressPolling();
    try {
      const result = await runScrapeRequest(jobTitles);
      set({
        candidates: [...result.created, ...get().candidates],
        running: false,
        lastRunReport: result.portalReport,
        lastRunCreated: result.created,
      });
      return result;
    } catch (err) {
      set({ running: false, error: err instanceof ApiError ? err.message : 'Unable to run scrape.' });
      throw err;
    } finally {
      get().stopProgressPolling();
    }
  },

  fetchProgress: async () => {
    try {
      const { active, events } = await getRunProgress(get().progressLastSeq);
      if (events.length === 0) return;
      set({
        // A pathological run could stream many events; the UI only ever shows the
        // last few, so trimming here (not just in the component) keeps this array
        // from growing for the whole duration of a long run.
        progressEvents: [...get().progressEvents, ...events].slice(-PROGRESS_EVENTS_KEPT),
        progressLastSeq: events[events.length - 1].seq,
      });
      if (!active) get().stopProgressPolling();
    } catch {
      // Best-effort — a missed poll must never surface as a user-facing error; the
      // run itself (POST /run) is what actually matters, and it reports its own
      // outcome independently of this feed.
    }
  },

  startProgressPolling: () => {
    if (get().progressPollHandle) return;
    const handle = setInterval(() => get().fetchProgress(), PROGRESS_POLL_INTERVAL_MS);
    set({ progressPollHandle: handle });
  },

  stopProgressPolling: () => {
    const { progressPollHandle } = get();
    if (progressPollHandle) clearInterval(progressPollHandle);
    set({ progressPollHandle: null });
  },

  // Dismissal itself stays instant and unconditional — the optional "why?" is a
  // separate, non-blocking follow-up (see setDismissReason below), never a gate on
  // this action, so rejecting an offer never gets slower than it is today.
  dismissCandidate: async (id) => {
    const updated = await dismissScrapedJobRequest(id);
    set({
      candidates: get().candidates.map((c) => (c.id === id ? updated : c)),
      lastDismissed: { id: updated.id, title: updated.title },
    });
    return updated;
  },

  // Persists the reason from the dismiss toast onto the candidate that was just
  // dismissed — feeds server/scraperCandidatesStore.js's listRejectionReasons, which
  // claudeCli.qualifyAll uses to score similar future postings lower (see
  // routes.scraper.js POST /qualify).
  setDismissReason: async (id, reason) => {
    const updated = await setDismissReasonRequest(id, reason);
    set({
      candidates: get().candidates.map((c) => (c.id === id ? updated : c)),
      lastDismissed: null,
    });
    return updated;
  },

  clearLastDismissed: () => set({ lastDismissed: null }),

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

  // Deliberately does NOT update `candidates` in place — the UI should keep showing
  // the "unseen" dot/grouping for these until the next full fetch/page load, so the
  // list doesn't visually reshuffle under the user while they're still scrolling or
  // reviewing it. The banner/sidebar counts staying stale until reload is the correct,
  // intended consequence of this same rule, not a separate thing to engineer.
  markCandidatesViewed: async (ids) => {
    if (ids.length === 0) return;
    await markScrapedJobsViewedRequest(ids);
  },
}));
