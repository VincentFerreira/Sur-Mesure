import { JobWorkMode, ScrapedJob, ScrapedJobFit, ScrapedJobStatus, ScrapedSignal, ScraperProgress } from '../types';
import { apiFetch } from './apiClient';

export interface QualifyResult {
  fit: ScrapedJobFit;
  score: number;
  signals: ScrapedSignal[];
}

export interface PortalReportEntry {
  portal: string;
  count: number;
  error?: string;
}

export interface RunScrapeResult {
  created: ScrapedJob[];
  portalReport: PortalReportEntry[];
  // Per-portal count of results dropped by the anti-noise relevance pre-filter
  // (server/scraperRelevance.js) before they were ever stored — see routes.scraper.js.
  filteredCounts: Record<string, number>;
}

export interface QualifyCandidateInput {
  id: string;
  title: string;
  company: string;
  location?: string;
  descriptionRaw?: string;
}

export async function listScrapedJobs(status?: ScrapedJobStatus): Promise<ScrapedJob[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<ScrapedJob[]>(`/scraper/candidates${qs}`, undefined, 'Failed to list scraped jobs');
}

// `jobTitles`, when given, overrides SearchPreferences.jobTitles for this run only
// (used to pass an AI-expanded keyword list without persisting it into Preferences).
export async function runScrape(jobTitles?: string[]): Promise<RunScrapeResult> {
  return apiFetch<RunScrapeResult>(
    '/scraper/run',
    { method: 'POST', body: JSON.stringify(jobTitles ? { jobTitles } : {}) },
    'Failed to run scrape'
  );
}

// Live progress for the in-flight POST /run above — poll while it's outstanding, with
// the last-seen `seq` (0 on the first call), to get only the events that happened
// since. See server/scraperProgress.js / server/scrapers/claudeCli.js's
// runClaudeStreaming for where these events come from.
export async function getRunProgress(sinceSeq = 0): Promise<ScraperProgress> {
  return apiFetch<ScraperProgress>(`/scraper/run/progress?sinceSeq=${sinceSeq}`, undefined, 'Failed to fetch scrape progress');
}

// Widens `jobTitles` into more search keywords via the server-side `claude` CLI (see
// server/scrapers/claudeCli.js) — no separate API key/rate limit, same mechanism the
// claude_cli search portal already uses. Returns the combined, deduped list, ready to
// pass straight to runScrape().
export async function expandSearchKeywords(jobTitles: string[]): Promise<string[]> {
  if (jobTitles.length === 0) return [];
  const { jobTitles: expanded } = await apiFetch<{ jobTitles: string[] }>(
    '/scraper/expand-keywords',
    { method: 'POST', body: JSON.stringify({ jobTitles }) },
    'Failed to expand search keywords'
  );
  return expanded;
}

// Judges each candidate's fit against the *original* (non-expanded) job titles/
// locations/work modes, and optionally a CV text (serializeCVForATS output), via the
// same `claude` CLI mechanism.
export async function qualifyScrapedJobs(
  candidates: QualifyCandidateInput[],
  jobTitles: string[],
  locations: string[] = [],
  cvText?: string,
  workModes: JobWorkMode[] = []
): Promise<Record<string, QualifyResult>> {
  if (candidates.length === 0 || jobTitles.length === 0) return {};
  const { results } = await apiFetch<{ results: Record<string, QualifyResult> }>(
    '/scraper/qualify',
    { method: 'POST', body: JSON.stringify({ candidates, jobTitles, locations, workModes, cvText }) },
    'Failed to qualify scraped jobs'
  );
  return results;
}

export async function dismissScrapedJob(id: string, reason?: string): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'dismissed', ...(reason ? { dismissReason: reason } : {}) }) },
    'Failed to dismiss scraped job'
  );
}

// Adds/overwrites the reason on an already-dismissed candidate — the optional,
// non-blocking follow-up offered right after dismissing (see JobSearchPage.tsx's
// dismiss toast), so explaining why never slows down the dismiss action itself.
export async function setDismissReason(id: string, reason: string): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ dismissReason: reason }) },
    'Failed to save the dismiss reason'
  );
}

export async function markScrapedJobImported(id: string, importedJobId: string): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'imported', importedJobId }) },
    'Failed to mark scraped job as imported'
  );
}

// Persists fit+score+signals together in one PATCH. Setting fit to 'low' also
// dismisses the candidate in the same request, so it drops out of the default New view
// without a second round-trip; 'high'/'medium' explicitly (re-)confirm status 'new',
// which is a no-op for a just-created candidate.
export async function setScrapedJobQualification(id: string, qualification: QualifyResult): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        fit: qualification.fit,
        score: qualification.score,
        signals: qualification.signals,
        status: qualification.fit === 'low' ? 'dismissed' : 'new',
      }),
    },
    'Failed to update scraped job qualification'
  );
}

export async function deleteScrapedJob(id: string): Promise<void> {
  await apiFetch<{ success: true }>(`/scraper/candidates/${id}`, { method: 'DELETE' }, 'Failed to delete scraped job');
}

// Marks the given candidates as viewed for the first time (idempotent server-side —
// an already-viewed id is left untouched). Used for both a single row
// (IntersectionObserver) and the bulk "Tout marquer comme vu" button.
export async function markScrapedJobsViewed(ids: string[]): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };
  return apiFetch<{ success: true; count: number }>(
    '/scraper/candidates/mark-viewed',
    { method: 'POST', body: JSON.stringify({ ids }) },
    'Failed to mark scraped jobs as viewed'
  );
}
