import { formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ScrapedJobFit } from '../../types';

export const PORTAL_LABELS: Record<string, string> = {
  france_travail: 'France Travail',
  arbeitnow: 'Arbeitnow',
  freehire: 'Freehire',
  claude_cli: 'Claude (web search)',
  fake: 'Fake (test)',
};

export const portalLabel = (portal: string): string => PORTAL_LABELS[portal] ?? portal;

// Tier labels for the grouped discoveries list — user-facing, hence matching the rest
// of this app's UI copy.
export const FIT_GROUP_LABELS: Record<ScrapedJobFit, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Best fit first; a synthetic "unqualified" bucket (candidates with no score yet —
// qualification pass never ran or failed for them) is appended last by the caller.
export const FIT_GROUP_ORDER: ScrapedJobFit[] = ['high', 'medium', 'low'];
export const UNQUALIFIED_GROUP_LABEL = 'Not qualified';

// "8 months ago" — used both by the discoveries list itself and by JobSearchPage's
// "last scrape" subheading. Returns '—' for a missing/invalid date rather than throwing.
export function formatRelativeDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDistanceToNow(date, { addSuffix: true, locale: enUS });
}
