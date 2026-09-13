import { ScrapedJob, ScrapedJobFit, ScrapedJobStatus } from '../types';
import { apiFetch } from './apiClient';

export interface PortalReportEntry {
  portal: string;
  count: number;
  error?: string;
}

export interface RunScrapeResult {
  created: ScrapedJob[];
  portalReport: PortalReportEntry[];
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
// locations, and optionally a CV text (serializeCVForATS output), via the same `claude`
// CLI mechanism.
export async function qualifyScrapedJobs(
  candidates: QualifyCandidateInput[],
  jobTitles: string[],
  locations: string[] = [],
  cvText?: string
): Promise<Record<string, ScrapedJobFit>> {
  if (candidates.length === 0 || jobTitles.length === 0) return {};
  const { fitMap } = await apiFetch<{ fitMap: Record<string, ScrapedJobFit> }>(
    '/scraper/qualify',
    { method: 'POST', body: JSON.stringify({ candidates, jobTitles, locations, cvText }) },
    'Failed to qualify scraped jobs'
  );
  return fitMap;
}

export async function dismissScrapedJob(id: string): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) },
    'Failed to dismiss scraped job'
  );
}

export async function markScrapedJobImported(id: string, importedJobId: string): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'imported', importedJobId }) },
    'Failed to mark scraped job as imported'
  );
}

// Setting fit to 'low' also dismisses the candidate in the same request, so it drops
// out of the default New view without a second round-trip; 'high'/'medium' explicitly
// (re-)confirm status 'new', which is a no-op for a just-created candidate.
export async function setScrapedJobFit(id: string, fit: ScrapedJobFit): Promise<ScrapedJob> {
  return apiFetch<ScrapedJob>(
    `/scraper/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ fit, status: fit === 'low' ? 'dismissed' : 'new' }) },
    'Failed to update scraped job fit'
  );
}

export async function deleteScrapedJob(id: string): Promise<void> {
  await apiFetch<{ success: true }>(`/scraper/candidates/${id}`, { method: 'DELETE' }, 'Failed to delete scraped job');
}
