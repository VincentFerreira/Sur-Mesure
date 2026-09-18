import { create } from 'zustand';
import { SearchPreferences } from '../types';
import { getPreferences, savePreferences as savePreferencesRequest, SavePreferencesInput } from '../services/preferencesService';

interface PreferencesState {
  preferences: SearchPreferences | null;
  loading: boolean;
  error: string | null;
  fetchPreferences: () => Promise<void>;
  savePreferences: (input: SavePreferencesInput) => Promise<SearchPreferences>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  preferences: null,
  loading: false,
  error: null,

  fetchPreferences: async () => {
    set({ loading: true, error: null });
    try {
      set({ preferences: await getPreferences(), loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load preferences. Is the server running?' });
    }
  },

  // Doesn't catch its own errors — the page's Save button handles/displays the
  // failure inline, same as CompanyForm's submit handler.
  savePreferences: async (input) => {
    const preferences = await savePreferencesRequest(input);
    set({ preferences });
    return preferences;
  },
}));
