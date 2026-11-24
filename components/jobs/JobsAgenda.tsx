import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check } from 'lucide-react';
import { Job } from '../../types';
import { useJobsStore } from '../../store/jobsStore';
import { AGENDA_GROUPS, AgendaGroup, buildAgenda } from '../../lib/agenda';
import { APPOINTMENT_META, formatAppointmentDate, formatAppointmentTime } from './appointmentMeta';

interface Props {
  jobs: Job[];
}

const GROUP_LABELS: Record<AgendaGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  thisWeek: 'Next 7 days',
  later: 'Later',
};

const JobsAgenda: React.FC<Props> = ({ jobs }) => {
  const toggleAppointmentDone = useJobsStore((s) => s.toggleAppointmentDone);
  const groups = useMemo(() => buildAgenda(jobs), [jobs]);
  const total = AGENDA_GROUPS.reduce((n, g) => n + groups[g].length, 0);

  if (total === 0) {
    return (
      <div data-testid="jobs-agenda" className="text-center py-16 text-slate-400">
        <CalendarClock className="w-8 h-8 mx-auto mb-3 text-slate-300" />
        <p className="mb-1 text-slate-500 font-medium">No upcoming appointments.</p>
        <p className="text-sm">Add one from a job's page (calls, interviews, follow-ups, deadlines).</p>
      </div>
    );
  }

  return (
    <div data-testid="jobs-agenda" className="space-y-6">
      {AGENDA_GROUPS.filter((g) => groups[g].length > 0).map((group) => {
        const overdue = group === 'overdue';
        return (
          <section key={group} data-testid={`agenda-group-${group}`}>
            <h2 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${overdue ? 'text-amber-600' : 'text-slate-400'}`}>
              {GROUP_LABELS[group]} <span className="font-normal">· {groups[group].length}</span>
            </h2>
            <ol className="relative border-l border-slate-200 ml-3 space-y-3">
              {groups[group].map(({ job, appointment }) => {
                const meta = APPOINTMENT_META[appointment.type];
                const Icon = meta.icon;
                return (
                  <li key={appointment.id} data-testid={`agenda-item-${appointment.id}`} className="ml-6">
                    <span
                      className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-4 ring-white ${
                        overdue ? 'bg-amber-100 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div
                      className={`flex items-start justify-between gap-3 bg-white border rounded-lg px-3.5 py-2.5 ${
                        overdue ? 'border-amber-200' : 'border-slate-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-xs font-medium ${overdue ? 'text-amber-700' : 'text-slate-500'}`}>
                          {formatAppointmentDate(appointment.at)} · {formatAppointmentTime(appointment.at)}
                          <span className="text-slate-300"> · </span>
                          <span className="text-slate-400">{meta.label}</span>
                        </p>
                        <p className="text-sm font-semibold text-slate-800 truncate">{appointment.label}</p>
                        {appointment.contact && (
                          <p className="text-xs text-slate-500 truncate">with {appointment.contact}</p>
                        )}
                        <Link
                          to={`/jobs/${job.id}`}
                          className="text-xs text-indigo-600 hover:text-indigo-800 truncate block mt-0.5"
                        >
                          {job.company} · {job.title}
                        </Link>
                      </div>
                      <button
                        onClick={() => toggleAppointmentDone(job.id, appointment.id, true)}
                        data-testid={`agenda-done-${appointment.id}`}
                        title="Mark as done"
                        className="shrink-0 flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 rounded-md px-2 py-1 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" /> Done
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
};

export default JobsAgenda;
