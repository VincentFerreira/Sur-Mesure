import { Job, JobAppointment } from '../types';

export const AGENDA_GROUPS = ['overdue', 'today', 'thisWeek', 'later'] as const;
export type AgendaGroup = (typeof AGENDA_GROUPS)[number];

export interface AgendaItem {
  job: Job;
  appointment: JobAppointment;
}

const CLOSED_STATUSES: Job['status'][] = ['archived', 'rejected'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Flattens every pending appointment of every still-open job into one chronological
 * list, bucketed by period relative to `now` (local time):
 * - overdue: before now (even earlier today — a missed 9am call at 2pm is overdue)
 * - today: later today
 * - thisWeek: from tomorrow up to 7 days out (rolling, not calendar week)
 * - later: beyond that
 */
export function buildAgenda(jobs: Job[], now: Date = new Date()): Record<AgendaGroup, AgendaItem[]> {
  const groups: Record<AgendaGroup, AgendaItem[]> = { overdue: [], today: [], thisWeek: [], later: [] };
  const tomorrow = startOfDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(tomorrow);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const items: AgendaItem[] = jobs
    .filter((job) => !CLOSED_STATUSES.includes(job.status))
    .flatMap((job) => (job.appointments ?? []).filter((a) => !a.done).map((appointment) => ({ job, appointment })))
    .sort((a, b) => a.appointment.at.localeCompare(b.appointment.at));

  for (const item of items) {
    const at = new Date(item.appointment.at);
    if (at < now) groups.overdue.push(item);
    else if (at < tomorrow) groups.today.push(item);
    else if (at < weekEnd) groups.thisWeek.push(item);
    else groups.later.push(item);
  }
  return groups;
}
