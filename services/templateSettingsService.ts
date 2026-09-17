import { TemplateSettings } from '../types';
import { apiFetch } from './apiClient';

export async function getTemplateSettings(): Promise<TemplateSettings> {
  return apiFetch<TemplateSettings>('/template-settings', undefined, 'Failed to load template settings');
}

export async function updateTemplateSettings(fontId: string): Promise<TemplateSettings> {
  return apiFetch<TemplateSettings>(
    '/template-settings',
    { method: 'PUT', body: JSON.stringify({ fontId }) },
    'Failed to save template settings'
  );
}
