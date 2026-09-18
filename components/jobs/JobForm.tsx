import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Job, JobContractType, JobWorkMode } from '../../types';
import { CreateJobInput } from '../../services/jobService';
import { useCompaniesStore } from '../../store/companiesStore';

interface Props {
  open: boolean;
  // A full Job (edit mode) or a partial prefill with no `id` (e.g. from AI extraction —
  // still creates a new job on submit).
  initial?: Partial<Job>;
  onClose: () => void;
  onSubmit: (input: CreateJobInput) => Promise<void>;
}

const WORK_MODES: JobWorkMode[] = ['onsite', 'hybrid', 'remote'];
const CONTRACT_TYPES: JobContractType[] = ['CDI', 'CDD', 'freelance', 'internship'];

const JobForm: React.FC<Props> = ({ open, initial, onClose, onSubmit }) => {
  const { companies, fetchCompanies } = useCompaniesStore();
  const [company, setCompany] = useState(initial?.company ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [descriptionRaw, setDescriptionRaw] = useState(initial?.descriptionRaw ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [workMode, setWorkMode] = useState<JobWorkMode | ''>(initial?.workMode ?? '');
  const [contractType, setContractType] = useState<JobContractType | ''>(initial?.contractType ?? '');
  const [salaryRange, setSalaryRange] = useState(initial?.salaryRange ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [contactName, setContactName] = useState(initial?.contactName ?? '');
  const [priority, setPriority] = useState<1 | 2 | 3>(initial?.priority ?? 2);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The form stays mounted (returning null) while closed, so `open` — not just
  // mount — must be a dependency: otherwise a company created after this component's
  // first mount would never show up in the suggestions list.
  useEffect(() => { if (open) fetchCompanies(); }, [open, fetchCompanies]);

  if (!open) return null;

  const isEdit = Boolean(initial?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !title.trim() || !descriptionRaw.trim()) {
      setError('Company, title and job description are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        company: company.trim(),
        title: title.trim(),
        descriptionRaw: descriptionRaw.trim(),
        location: location.trim() || undefined,
        workMode: workMode || undefined,
        contractType: contractType || undefined,
        salaryRange: salaryRange.trim() || undefined,
        url: url.trim() || undefined,
        source: source.trim() || undefined,
        contactName: contactName.trim() || undefined,
        priority,
        notes: notes.trim() || undefined,
        keywords: initial?.keywords,
      });
      onClose();
    } catch {
      setError('Save error. Is the server running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="job-form"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">{isEdit ? 'Edit job' : 'New job'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && <div className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Company *</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                list="job-company-suggestions"
                data-testid="job-company-input"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <datalist id="job-company-suggestions">
                {companies.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="job-title-input" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Job description *</label>
            <textarea
              value={descriptionRaw}
              onChange={(e) => setDescriptionRaw(e.target.value)}
              placeholder="Paste the job posting text here"
              rows={6}
              data-testid="job-description-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Salary range</label>
              <input value={salaryRange} onChange={(e) => setSalaryRange(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Work mode</label>
              <select value={workMode} onChange={(e) => setWorkMode(e.target.value as JobWorkMode | '')} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">—</option>
                {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Contract</label>
              <select value={contractType} onChange={(e) => setContractType(e.target.value as JobContractType | '')} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">—</option>
                {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Priority</label>
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value={1}>High</option>
                <option value={2}>Medium</option>
                <option value={3}>Low</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Source</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Contact</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid="job-form-submit"
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save' : 'Create job'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default JobForm;
