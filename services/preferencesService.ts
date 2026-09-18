import { SearchPreferences } from '../types';
import { apiFetch } from './apiClient';

// `franceTravailClientSecret` is write-only: GET never returns the real secret (see
// SearchPreferences.franceTravailClientSecretConfigured), so it isn't part of
// SearchPreferences itself — it's added here as a save-only field. Omit it to leave
// the stored secret unchanged; send '' to explicitly clear it.
export type SavePreferencesInput = Omit<SearchPreferences, 'updatedAt' | 'franceTravailClientSecretConfigured'> & {
  franceTravailClientSecret?: string;
};

export async function getPreferences(): Promise<SearchPreferences> {
  return apiFetch<SearchPreferences>('/preferences', undefined, 'Failed to load preferences');
}

export async function savePreferences(input: SavePreferencesInput): Promise<SearchPreferences> {
  return apiFetch<SearchPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(input) }, 'Failed to save preferences');
}
