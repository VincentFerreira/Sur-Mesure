import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, LayoutGrid, List, Loader2, Plus, Sparkles } from 'lucide-react';
import { useJobsStore } from '../store/jobsStore';
import { useCvsStore } from '../store/cvsStore';
import { Job, JOB_STATUSES, JobStatus } from '../types';
import { STATUS_META } from '../components/jobs/statusMeta';
import JobsTable from '../components/jobs/JobsTable';
import JobsKanban from '../components/jobs/JobsKanban';
import JobForm from '../components/jobs/JobForm';
import ImportJobDialog from '../components/jobs/ImportJobDialog';
import { isJobStale } from '../lib/jobStale';

const VIEW_STORAGE_KEY = 'yarb-jobs-view';
const APPLIED_STATUSES: JobStatus[] = ['applied', 'screening', 'interview', 'offer'];
const ACTIVE_STATUSES: JobStatus[] = ['lead', 'to_apply', 'applied', 'screening', 'interview', 'offer'];

function isDue(job: Job): boolean {
  return Boolean(job.nextActionAt) && new Date(job.nextActionAt!).getTime() <= Date.now();
}

const JobsPage: React.FC = () => {
  const {
    jobs, loading, error, statusFilter, query, staleOnly, dueOnly,
    fetchJobs, setStatusFilter, setQuery, setStaleOnly, setDueOnly, addJob,
  } = useJobsStore();
  const { cvs, fetchCvs } = useCvsStore();
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'table' | 'kanban'>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_STORAGE_KEY) === 'kanban' ? 'kanban' : 'table')
  );

  useEffect(() => {
    fetchJobs();
    fetchCvs();
  }, [fetchJobs, fetchCvs]);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const cvsById = useMemo(() => new Map(cvs.map((c) => [c.id, c])), [cvs]);

  const filteredJobs = useMemo(() => {
    let list = jobs;
    if (statusFilter.length > 0) list = list.filter((j) => statusFilter.includes(j.status));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((j) => j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q));
    }
    if (staleOnly) {
      list = list.filter((job) => isJobStale(job, job.cvId ? cvsById.get(job.cvId) : undefined));
    }
    if (dueOnly) list = list.filter(isDue);
    return list;
  }, [jobs, statusFilter, query, staleOnly, dueOnly, cvsById]);

  const kpis = useMemo(() => ({
    active: jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length,
    applied: jobs.filter((j) => APPLIED_STATUSES.includes(j.status)).length,
    interviewing: jobs.filter((j) => j.status === 'interview').length,
    due: jobs.filter((j) => isDue(j) && j.status !== 'archived' && j.status !== 'rejected').length,
  }), [jobs]);

  const toggleStatus = (status: JobStatus) => {
    setStatusFilter(
      statusFilter.includes(status) ? statusFilter.filter((s) => s !== status) : [...statusFilter, status]
    );
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="jobs-page">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-800">Jobs</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              data-testid="import-job-button"
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold hover:border-indigo-200 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Import
            </button>
            <button
              onClick={() => setFormOpen(true)}
              data-testid="new-job-button"
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New job
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {([
            {
              key: 'active', label: 'Active jobs', value: kpis.active,
              onClick: () => { setStatusFilter(ACTIVE_STATUSES); setDueOnly(false); },
            },
            {
              key: 'applied', label: 'Applications sent', value: kpis.applied,
              onClick: () => { setStatusFilter(APPLIED_STATUSES); setDueOnly(false); },
            },
            {
              key: 'interviewing', label: 'Interviews in progress', value: kpis.interviewing,
              onClick: () => { setStatusFilter(['interview']); setDueOnly(false); },
            },
            {
              key: 'due', label: 'Follow-ups due', value: kpis.due,
              onClick: () => { setStatusFilter([]); setDueOnly(true); },
            },
          ] as const).map((tile) => (
            <button
              key={tile.key}
              onClick={tile.onClick}
              data-testid={`kpi-${tile.key}`}
              className="text-left bg-white border border-slate-200 rounded-xl p-3.5 hover:border-indigo-200 transition-colors"
            >
              <p className="text-2xl font-bold text-slate-800">{tile.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{tile.label}</p>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mb-4">
          {view === 'table' ? (
            <div className="flex flex-wrap items-center gap-2">
              {JOB_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  data-testid={`filter-status-${status}`}
                  className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors ${
                    statusFilter.includes(status)
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {STATUS_META[status].label}
                </button>
              ))}
            </div>
          ) : <div />}

          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 shrink-0">
            <button
              onClick={() => setView('table')}
              data-testid="view-table-button"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="w-3.5 h-3.5" /> Table
            </button>
            <button
              onClick={() => setView('kanban')}
              data-testid="view-kanban-button"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'kanban' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Kanban
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQuery(search)}
            onBlur={() => setQuery(search)}
            placeholder="Search company or title…"
            data-testid="job-search-input"
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          {view === 'table' && (
            <label className="flex items-center gap-1.5 text-sm text-slate-500 whitespace-nowrap">
              <input
                type="checkbox"
                checked={staleOnly}
                onChange={(e) => setStaleOnly(e.target.checked)}
                data-testid="stale-only-filter"
              />
              Stale score only
            </label>
          )}
        </div>

        {error && <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>}

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && filteredJobs.length === 0 && !error && (
          <div className="text-center py-16 text-slate-400">
            <Briefcase className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="mb-1 text-slate-500 font-medium">No jobs match these filters.</p>
            {jobs.length === 0 && (
              <p className="text-sm">
                <button onClick={() => setFormOpen(true)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  Add your first job
                </button>
                {' '}by pasting its description.
              </p>
            )}
          </div>
        )}

        {!loading && filteredJobs.length > 0 && view === 'table' && <JobsTable jobs={filteredJobs} cvsById={cvsById} />}
        {!loading && filteredJobs.length > 0 && view === 'kanban' && <JobsKanban jobs={filteredJobs} cvsById={cvsById} />}
      </div>

      <JobForm open={formOpen} onClose={() => setFormOpen(false)} onSubmit={(input) => addJob(input).then(() => {})} />
      <ImportJobDialog open={importOpen} onClose={() => setImportOpen(false)} onSubmit={(input) => addJob(input).then(() => {})} />
    </div>
  );
};

export default JobsPage;
