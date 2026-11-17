import React from 'react';
import { Bell, CalendarClock, Flag, Phone, Users } from 'lucide-react';
import { AppointmentType } from '../../types';

export const APPOINTMENT_META: Record<AppointmentType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  call: { label: 'Call', icon: Phone },
  interview: { label: 'Interview', icon: Users },
  follow_up: { label: 'Follow-up', icon: Bell },
  deadline: { label: 'Deadline', icon: Flag },
  other: { label: 'Other', icon: CalendarClock },
};

export function formatAppointmentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatAppointmentTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
