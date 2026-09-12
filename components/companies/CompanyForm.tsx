import React, { useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { Company, COMPANY_SIZES } from '../../types';
import { CreateCompanyInput } from '../../services/companyService';

interface Props {
  open: boolean;
  // A full Company (edit mode) or no id (create mode, optionally prefilled e.g. from bulk-add).
  initial?: Partial<Company>;
  onClose: () => void;
  onSubmit: (input: CreateCompanyInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const CompanyForm: React.FC<Props> = ({ open, initial, onClose, onSubmit, onDelete }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [size, setSize] = useState<Company['size'] | ''>(initial?.size ?? '');
  const [remoteFriendly, setRemoteFriendly] = useState(initial?.remoteFriendly ?? false);
  const [next40, setNext40] = useState(initial?.next40 ?? false);
  const [frenchTech120, setFrenchTech120] = useState(initial?.frenchTech120 ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  if (!open) return null;

  const isEdit = Boolean(initial?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Company name is required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        website: website.trim() || undefined,
        location: location.trim() || undefined,
        size: size || undefined,
        remoteFriendly,
        next40,
        frenchTech120,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch {
      setError('Save error. Is the server running?');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial?.id || !onDelete) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleteConfirm(false);
    setDeleting(true);
    setError(null);
    try {
      await onDelete(initial.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Unable to delete this company.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="company-form"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">{isEdit ? 'Edit company' : 'New company'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && <div className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <div>
            <label className="text-xs font-medium text-slate-500">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="company-name-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Website</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                data-testid="company-website-input"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                data-testid="company-location-input"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value as Company['size'] | '')}
              data-testid="company-size-select"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">—</option>
              {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={remoteFriendly} onChange={(e) => setRemoteFriendly(e.target.checked)} data-testid="company-remote-checkbox" />
              Remote-friendly
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={next40} onChange={(e) => setNext40(e.target.checked)} data-testid="company-next40-checkbox" />
              NEXT40
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={frenchTech120} onChange={(e) => setFrenchTech120(e.target.checked)} data-testid="company-frenchtech120-checkbox" />
              FrenchTech120
            </label>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              data-testid="company-notes-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between gap-2">
          {isEdit && onDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              onBlur={() => setDeleteConfirm(false)}
              disabled={deleting}
              data-testid="company-delete-button"
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                deleteConfirm ? 'text-red-600 hover:text-red-800' : 'text-slate-400 hover:text-red-500'
              }`}
              title={deleteConfirm ? 'Click to confirm deletion' : 'Delete'}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {deleteConfirm ? 'Confirm delete?' : 'Delete'}
            </button>
          ) : <div />}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="company-form-submit"
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Save' : 'Add company'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CompanyForm;
