import React, { useState } from 'react';
import { CalendarPlus, Check, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { APPOINTMENT_TYPES, AppointmentType, Job, JobAppointment } from '../../types';
import { useJobsStore } from '../../store/jobsStore';
import { ApiError } from '../../services/apiClient';
import { APPOINTMENT_META, formatAppointmentDate, formatAppointmentTime } from './appointmentMeta';

interface Props {
  job: Job;
  onChange: (job: Job) => void;
}

interface Draft {
  at: string; // datetime-local value, local time
  type: AppointmentType;
  label: string;
  contact: string;
  notes: string;
}

// ISO → value for <input type="datetime-local"> (local time, minute precision).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(): Draft {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return { at: toLocalInput(tomorrow.toISOString()), type: 'call', label: '', contact: '', notes: '' };
}

function draftFrom(a: JobAppointment): Draft {
  return { at: toLocalInput(a.at), type: a.type, label: a.label, contact: a.contact ?? '', notes: a.notes ?? '' };
}

const inputClass =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300';

const JobAppointments: React.FC<Props> = ({ job, onChange }) => {
  const { addAppointment, updateAppointment, deleteAppointment } = useJobsStore();
  // null = form closed, 'new' = adding, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appointments = [...(job.appointments ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const pending = appointments.filter((a) => !a.done);
  const done = appointments.filter((a) => a.done).reverse();

  const run = async (fn: () => Promise<Job>) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await fn());
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save appointment.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => { setDraft(emptyDraft()); setEditing('new'); setError(null); };
  const openEdit = (a: JobAppointment) => { setDraft(draftFrom(a)); setEditing(a.id); setError(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim() || !draft.at) return;
    const input = {
      at: new Date(draft.at).toISOString(),
      type: draft.type,
      label: draft.label.trim(),
      contact: draft.contact.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    };
    const ok = await run(() =>
      editing === 'new'
        ? addAppointment(job.id, input)
        // On edit, send '' for cleared optional fields so the server drops them.
        : updateAppointment(job.id, editing!, { ...input, contact: input.contact ?? '', notes: input.notes ?? '' })
    );
    if (ok) setEditing(null);
  };

  const renderRow = (a: JobAppointment) => {
    const meta = APPOINTMENT_META[a.type];
    const Icon = meta.icon;
    const overdue = !a.done && new Date(a.at).getTime() < Date.now();
    return (
      <li key={a.id} data-testid={`appointment-${a.id}`} className={`flex items-start gap-3 ${a.done ? 'opacity-60' : ''}`}>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          overdue ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm text-slate-700 ${a.done ? 'line-through' : ''}`}>
            {a.label}
            {a.contact && <span className="text-slate-400"> · with {a.contact}</span>}
          </p>
          <p className={`text-xs mt-0.5 ${overdue ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
            {meta.label} · {formatAppointmentDate(a.at)} · {formatAppointmentTime(a.at)}
            {overdue && ' · overdue'}
          </p>
          {a.notes && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{a.notes}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => run(() => updateAppointment(job.id, a.id, { done: !a.done }))}
            disabled={saving}
            data-testid={`appointment-toggle-${a.id}`}
            title={a.done ? 'Mark as not done' : 'Mark as done'}
            className="p-1.5 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {a.done ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          {!a.done && (
            <button
              onClick={() => openEdit(a)}
              data-testid={`appointment-edit-${a.id}`}
              title="Edit"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => run(() => deleteAppointment(job.id, a.id))}
            disabled={saving}
            data-testid={`appointment-delete-${a.id}`}
            title="Delete"
            className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6" data-testid="appointments-section">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Appointments</p>
        {editing === null && (
          <button
            onClick={openNew}
            data-testid="add-appointment-button"
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <CalendarPlus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {editing !== null && (
        <form onSubmit={handleSubmit} data-testid="appointment-form" className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 bg-slate-50 rounded-lg p-3">
          <input
            type="datetime-local"
            required
            value={draft.at}
            onChange={(e) => setDraft({ ...draft, at: e.target.value })}
            data-testid="appointment-form-at"
            className={inputClass}
          />
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as AppointmentType })}
            data-testid="appointment-form-type"
            className={inputClass}
          >
            {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{APPOINTMENT_META[t].label}</option>)}
          </select>
          <input
            required
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="What (e.g. Call with the recruiter)"
            data-testid="appointment-form-label"
            className={inputClass}
          />
          <input
            value={draft.contact}
            onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
            placeholder="With whom (optional)"
            data-testid="appointment-form-contact"
            className={inputClass}
          />
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notes (optional)"
            rows={2}
            data-testid="appointment-form-notes"
            className={`${inputClass} sm:col-span-2`}
          />
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="appointment-form-submit"
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editing === 'new' ? 'Add appointment' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

      {appointments.length === 0 && editing === null && (
        <p className="text-sm text-slate-400">No appointments scheduled.</p>
      )}
      {pending.length > 0 && <ul className="space-y-3">{pending.map(renderRow)}</ul>}
      {done.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-slate-400 cursor-pointer select-none">Done ({done.length})</summary>
          <ul className="space-y-3 mt-3">{done.map(renderRow)}</ul>
        </details>
      )}
    </div>
  );
};

export default JobAppointments;
