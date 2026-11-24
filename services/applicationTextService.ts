import { ApplicationTextType, Job } from '../types';
import { apiFetch } from './apiClient';

export async function generateApplicationText(
  jobId: string,
  textType: ApplicationTextType,
  cvText: string
): Promise<string> {
  const { text } = await apiFetch<{ text: string }>(
    `/jobs/${jobId}/generate-application-text`,
    { method: 'POST', body: JSON.stringify({ textType, cvText }) },
    'Failed to generate application text'
  );
  return text;
}

// Fire-and-forget from the caller's perspective: the request itself only waits for
// the job to be marked 'pending' (fast) — the actual claude CLI call keeps running
// server-side after this resolves, and its result lands on the job record, picked up
// by JobDetail.tsx's polling. See server/routes.jobs.js's POST
// /:id/evaluate-experience-matches.
export async function triggerExperienceInsights(jobId: string, cvText: string): Promise<Job> {
  return apiFetch<Job>(
    `/jobs/${jobId}/evaluate-experience-matches`,
    { method: 'POST', body: JSON.stringify({ cvText }) },
    'Failed to start experience-match insights'
  );
}
