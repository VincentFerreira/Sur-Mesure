import { create } from 'zustand';
import { DEFAULT_FONT_ID } from '../lib/fonts';
import { ApiError } from '../services/apiClient';
import { getTemplateSettings, updateTemplateSettings } from '../services/templateSettingsService';

interface TemplateSettingsState {
  fontId: string;
  loading: boolean;
  error: string | null;
  fetchTemplateSettings: () => Promise<void>;
  setFont: (fontId: string) => Promise<void>;
}

export const useTemplateSettingsStore = create<TemplateSettingsState>((set, get) => ({
  fontId: DEFAULT_FONT_ID,
  loading: false,
  error: null,

  fetchTemplateSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await getTemplateSettings();
      set({ fontId: settings.fontId, loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load template settings. Is the server running?' });
    }
  },

  // Optimistic: applied immediately so the LaTeX/PDF preview can recompile without
  // waiting on the network, rolled back if the server rejects it — same pattern as
  // jobsStore's moveJob.
  setFont: async (fontId) => {
    const previous = get().fontId;
    if (previous === fontId) return;

    set({ fontId, error: null });
    try {
      const settings = await updateTemplateSettings(fontId);
      set({ fontId: settings.fontId });
    } catch (err) {
      set({
        fontId: previous,
        error: err instanceof ApiError ? err.message : 'Unable to save font.',
      });
    }
  },
}));
