import { ApplicationTextType } from '../types';
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
