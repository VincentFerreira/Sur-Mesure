import { JobStatus } from '../../types';

export const STATUS_META: Record<JobStatus, { label: string; className: string }> = {
  lead: { label: 'Lead', className: 'bg-slate-100 text-slate-600' },
  to_apply: { label: 'To apply', className: 'bg-sky-50 text-sky-700' },
  applied: { label: 'Applied', className: 'bg-indigo-50 text-indigo-700' },
  screening: { label: 'Screening', className: 'bg-amber-50 text-amber-700' },
  interview: { label: 'Interview', className: 'bg-purple-50 text-purple-700' },
  offer: { label: 'Offer', className: 'bg-green-50 text-green-700' },
  rejected: { label: 'Rejected', className: 'bg-red-50 text-red-700' },
  archived: { label: 'Archived', className: 'bg-slate-100 text-slate-400' },
};

export const PRIORITY_META: Record<1 | 2 | 3, { label: string; className: string }> = {
  1: { label: 'High', className: 'text-red-600' },
  2: { label: 'Medium', className: 'text-amber-600' },
  3: { label: 'Low', className: 'text-slate-400' },
};
