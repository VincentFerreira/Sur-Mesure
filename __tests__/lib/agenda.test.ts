import { describe, it, expect } from 'vitest';
import { buildAgenda } from '../../lib/agenda';
import { Job, JobAppointment } from '../../types';

// Fixed "now": Saturday 2026-11-07 14:00 local time.
const NOW = new Date(2026, 10, 7, 14, 0);
const local = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();

let seq = 0;
function appt(at: string, extra: Partial<JobAppointment> = {}): JobAppointment {
  seq += 1;
  return { id: `a${seq}`, at, type: 'call', label: `Appt ${seq}`, done: false, createdAt: at, ...extra };
}

function job(appointments: JobAppointment[], extra: Partial<Job> = {}): Job {
  return {
    id: `j${seq}`, company: 'Co', title: 'Dev', status: 'applied', priority: 2,
    descriptionRaw: '', keywords: [], submitted: false, events: [], appointments,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra,
  };
}

describe('buildAgenda', () => {
  it('buckets appointments into overdue / today / next 7 days / later', () => {
    const missedThisMorning = appt(local(2026, 11, 7, 9));
    const lastWeek = appt(local(2026, 10, 30));
    const tonight = appt(local(2026, 11, 7, 18));
    const tomorrow = appt(local(2026, 11, 8));
    const inSixDays = appt(local(2026, 11, 14));
    const inTenDays = appt(local(2026, 11, 17));
    const groups = buildAgenda(
      [job([tonight, inTenDays, missedThisMorning]), job([tomorrow, lastWeek, inSixDays])],
      NOW
    );
    expect(groups.overdue.map((i) => i.appointment.id)).toEqual([lastWeek.id, missedThisMorning.id]);
    expect(groups.today.map((i) => i.appointment.id)).toEqual([tonight.id]);
    expect(groups.thisWeek.map((i) => i.appointment.id)).toEqual([tomorrow.id, inSixDays.id]);
    expect(groups.later.map((i) => i.appointment.id)).toEqual([inTenDays.id]);
  });

  it('keeps a reference to the owning job', () => {
    const a = appt(local(2026, 11, 9));
    const j = job([a], { company: 'Externatic' });
    expect(buildAgenda([j], NOW).thisWeek[0].job.company).toBe('Externatic');
  });

  it('excludes done appointments and archived/rejected jobs', () => {
    const groups = buildAgenda(
      [
        job([appt(local(2026, 11, 9), { done: true })]),
        job([appt(local(2026, 11, 9))], { status: 'archived' }),
        job([appt(local(2026, 11, 9))], { status: 'rejected' }),
      ],
      NOW
    );
    expect(Object.values(groups).flat()).toHaveLength(0);
  });

  it('treats jobs without an appointments field as having none', () => {
    const legacy = job([]);
    delete legacy.appointments;
    expect(Object.values(buildAgenda([legacy], NOW)).flat()).toHaveLength(0);
  });
});
