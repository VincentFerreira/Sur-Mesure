import { create } from 'zustand';
import { Company } from '../types';
import {
  bulkCreateCompanies,
  BulkCreateCompaniesResult,
  createCompany,
  CreateCompanyInput,
  deleteCompany as deleteCompanyRequest,
  listCompanies,
  updateCompany as updateCompanyRequest,
} from '../services/companyService';
import { useJobsStore } from './jobsStore';

interface CompaniesState {
  companies: Company[];
  loading: boolean;
  error: string | null;
  fetchCompanies: () => Promise<void>;
  addCompany: (input: CreateCompanyInput) => Promise<Company>;
  bulkAddCompanies: (names: string[]) => Promise<BulkCreateCompaniesResult>;
  patchCompany: (id: string, patch: Partial<Company>) => Promise<Company>;
  removeCompany: (id: string) => Promise<void>;
}

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  companies: [],
  loading: false,
  error: null,

  fetchCompanies: async () => {
    set({ loading: true, error: null });
    try {
      const companies = await listCompanies();
      set({ companies, loading: false });
    } catch {
      set({ loading: false, error: 'Unable to load companies. Is the server running?' });
    }
  },

  // Creating/renaming a company can auto-link previously-unlinked Jobs server-side
  // (see backfillJobLinks in server/routes.companies.js) — refetch Jobs so any Job
  // list already in memory (e.g. CompaniesPage) reflects the new companyId without
  // requiring a manual page reload.
  addCompany: async (input) => {
    const company = await createCompany(input);
    // POST / is idempotent-by-name — replace-if-present, else prepend, so resubmitting
    // an existing name doesn't create a visual duplicate.
    const existingIndex = get().companies.findIndex((c) => c.id === company.id);
    set({
      companies:
        existingIndex >= 0
          ? get().companies.map((c) => (c.id === company.id ? company : c))
          : [company, ...get().companies],
    });
    useJobsStore.getState().fetchJobs();
    return company;
  },

  bulkAddCompanies: async (names) => {
    const result = await bulkCreateCompanies(names);
    if (result.created.length > 0) {
      set({ companies: [...result.created, ...get().companies] });
      useJobsStore.getState().fetchJobs();
    }
    return result;
  },

  patchCompany: async (id, patch) => {
    const updated = await updateCompanyRequest(id, patch);
    set({ companies: get().companies.map((c) => (c.id === id ? updated : c)) });
    if (patch.name) useJobsStore.getState().fetchJobs();
    return updated;
  },

  removeCompany: async (id) => {
    await deleteCompanyRequest(id);
    set({ companies: get().companies.filter((c) => c.id !== id) });
  },
}));
