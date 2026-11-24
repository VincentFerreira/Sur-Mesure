import { create } from 'zustand';
import { CvMeta } from '../types';
import { listCVs, deleteCV, duplicateCV } from '../services/cvStorageService';

interface CvsState {
  cvs: CvMeta[];
  loading: boolean;
  error: string | null;
  fetchCvs: () => Promise<void>;
  archiveCv: (id: string) => Promise<void>;
  duplicateCv: (id: string) => Promise<void>;
}

export const useCvsStore = create<CvsState>((set, get) => ({
  cvs: [],
  loading: false,
  error: null,

  fetchCvs: async () => {
    set({ loading: true, error: null });
    try {
      const cvs = await listCVs();
      set({ cvs, loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load CVs. Is the server running?' });
    }
  },

  archiveCv: async (id: string) => {
    const previous = get().cvs;
    set({ cvs: previous.filter((c) => c.id !== id) });
    try {
      await deleteCV(id);
    } catch {
      set({ cvs: previous, error: 'Unable to archive this CV.' });
    }
  },

  // Not optimistic: the copy's id and label come from the server.
  duplicateCv: async (id: string) => {
    set({ error: null });
    try {
      const copy = await duplicateCV(id);
      // Most recently updated first, matching the server's list order.
      set({ cvs: [copy, ...get().cvs] });
    } catch {
      set({ error: 'Unable to duplicate this CV.' });
    }
  },
}));
