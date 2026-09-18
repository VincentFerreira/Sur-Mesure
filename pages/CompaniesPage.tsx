import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Plus, RefreshCw, Upload } from 'lucide-react';
import { useCompaniesStore } from '../store/companiesStore';
import { useJobsStore } from '../store/jobsStore';
import { Company } from '../types';
import CompaniesTable from '../components/companies/CompaniesTable';
import CompanyForm from '../components/companies/CompanyForm';
import BulkAddCompaniesDialog from '../components/companies/BulkAddCompaniesDialog';

const normalize = (name: string) => name.trim().toLowerCase();

const CompaniesPage: React.FC = () => {
  const { companies, loading, error, fetchCompanies, addCompany, bulkAddCompanies, patchCompany, removeCompany } = useCompaniesStore();
  const { jobs, fetchJobs } = useJobsStore();
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  // Bumped on every open so <CompanyForm> (which stays mounted while closed, per its
  // own `if (!open) return null`) remounts with fresh field state each time — otherwise
  // its useState initializers, which only run on first mount, would keep showing
  // whatever `initial` was present the very first time the form ever opened.
  const [formSession, setFormSession] = useState(0);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchCompanies();
    fetchJobs();
  }, [fetchCompanies, fetchJobs]);

  const jobsByCompanyId = useMemo(() => {
    const map = new Map<string, typeof jobs>();
    for (const job of jobs) {
      if (!job.companyId) continue;
      map.set(job.companyId, [...(map.get(job.companyId) ?? []), job]);
    }
    return map;
  }, [jobs]);

  // Company names already used on a Job but with no Company record yet — the "sync"
  // button seeds one for each (idempotent create + auto-link happen server-side).
  const missingFromJobs = useMemo(() => {
    const existingNames = new Set(companies.map((c) => normalize(c.name)));
    const seen = new Set<string>();
    const names: string[] = [];
    for (const job of jobs) {
      if (!job.company) continue;
      const key = normalize(job.company);
      if (seen.has(key) || existingNames.has(key)) continue;
      seen.add(key);
      names.push(job.company.trim());
    }
    return names;
  }, [jobs, companies]);

  const filteredCompanies = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.trim().toLowerCase();
    return companies.filter((c) => c.name.toLowerCase().includes(q));
  }, [companies, search]);

  const handleSync = async () => {
    if (missingFromJobs.length === 0) return;
    setSyncing(true);
    try {
      await bulkAddCompanies(missingFromJobs);
    } finally {
      setSyncing(false);
    }
  };

  const openCreate = () => {
    setEditingCompany(null);
    setFormOpen(true);
    setFormSession((s) => s + 1);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setFormOpen(true);
    setFormSession((s) => s + 1);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingCompany(null);
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="companies-page">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-slate-800">Companies</h1>
          <div className="flex items-center gap-2">
            {missingFromJobs.length > 0 && (
              <button
                onClick={handleSync}
                disabled={syncing}
                data-testid="sync-companies-from-jobs-button"
                title="Create a company for every job that doesn't have one yet"
                className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold hover:border-indigo-200 disabled:opacity-50 transition-colors"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Add {missingFromJobs.length} from jobs
              </button>
            )}
            <button
              onClick={() => setBulkOpen(true)}
              data-testid="bulk-add-companies-button"
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold hover:border-indigo-200 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Bulk add
            </button>
            <button
              onClick={openCreate}
              data-testid="new-company-button"
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New company
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-6">{companies.length} companies</p>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            data-testid="company-search-input"
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        {error && <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>}

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && filteredCompanies.length === 0 && !error && (
          <div className="text-center py-16 text-slate-400">
            <Building2 className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="mb-1 text-slate-500 font-medium">No companies match this search.</p>
            {companies.length === 0 && (
              <p className="text-sm">
                <button onClick={() => setBulkOpen(true)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  Bulk add a list
                </button>
                {' '}or{' '}
                <button onClick={openCreate} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  add one company
                </button>
                .
              </p>
            )}
          </div>
        )}

        {!loading && filteredCompanies.length > 0 && (
          <CompaniesTable companies={filteredCompanies} jobsByCompanyId={jobsByCompanyId} onRowClick={openEdit} />
        )}
      </div>

      <CompanyForm
        key={formSession}
        open={formOpen}
        initial={editingCompany ?? undefined}
        onClose={closeForm}
        onSubmit={(input) =>
          (editingCompany ? patchCompany(editingCompany.id, input) : addCompany(input)).then(() => {})
        }
        onDelete={(id) => removeCompany(id)}
      />
      <BulkAddCompaniesDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
};

export default CompaniesPage;
