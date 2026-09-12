import { SearchPreferences } from '../types';
import { apiFetch } from './apiClient';

export type SavePreferencesInput = Omit<SearchPreferences, 'updatedAt'>;

export async function getPreferences(): Promise<SearchPreferences> {
  return apiFetch<SearchPreferences>('/preferences', undefined, 'Failed to load preferences');
}

export async function savePreferences(input: SavePreferencesInput): Promise<SearchPreferences> {
  return apiFetch<SearchPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(input) }, 'Failed to save preferences');
}
