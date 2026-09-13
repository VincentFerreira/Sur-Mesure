import { ScrapedJobStatus } from '../../types';

export const SCRAPED_JOB_STATUS_META: Record<ScrapedJobStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-sky-50 text-sky-700' },
  dismissed: { label: 'Dismissed', className: 'bg-slate-100 text-slate-400' },
  imported: { label: 'Imported', className: 'bg-green-50 text-green-700' },
};

export const PORTAL_LABELS: Record<string, string> = {
  france_travail: 'France Travail',
  arbeitnow: 'Arbeitnow',
  freehire: 'Freehire',
  claude_cli: 'Claude (recherche web)',
  fake: 'Fake (test)',
};

export const SCRAPED_JOB_FIT_META: Record<'high' | 'medium' | 'low', { label: string; className: string }> = {
  high: { label: 'High fit', className: 'bg-emerald-50 text-emerald-700' },
  medium: { label: 'Medium fit', className: 'bg-amber-50 text-amber-700' },
  low: { label: 'Low fit', className: 'bg-slate-100 text-slate-400' },
};

export const portalLabel = (portal: string): string => PORTAL_LABELS[portal] ?? portal;
