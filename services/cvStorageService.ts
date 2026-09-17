import { CVData, CvMeta, CvRecord } from '../types';
import { createMultiLangString, createMultiLangArray } from '../lib/i18n';
import { API_PORT } from './apiClient';

const API_BASE = `http://${window.location.hostname}:${API_PORT}/api`;
const LS_KEY = 'cv_autosave';

export type CVMeta = CvMeta;
export type CVRecord = CvRecord;

export async function listCVs(): Promise<CVMeta[]> {
  const res = await fetch(`${API_BASE}/cvs`);
  if (!res.ok) throw new Error('Failed to list CVs');
  return res.json();
}

export async function loadCV(id: string): Promise<CVRecord> {
  const res = await fetch(`${API_BASE}/cvs/${id}`);
  if (!res.ok) throw new Error('CV not found');
  const record: CVRecord = await res.json();
  const migrated = migrateCV(record.data);
  return migrated ? { ...record, data: migrated } : record;
}

export async function createCV(label: string, data: CVData): Promise<CVMeta> {
  const res = await fetch(`${API_BASE}/cvs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error('Failed to create CV');
  return res.json();
}

export async function saveCV(id: string, label: string, data: CVData): Promise<CVMeta> {
  const res = await fetch(`${API_BASE}/cvs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error('Failed to save CV');
  return res.json();
}

export async function duplicateCV(sourceId: string, label: string): Promise<CVMeta> {
  const res = await fetch(`${API_BASE}/cvs?duplicateOf=${sourceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error('Failed to duplicate CV');
  return res.json();
}

export async function deleteCV(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/cvs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete CV');
}

export function autoSaveToLocalStorage(data: CVData): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
}

export function restoreFromLocalStorage(): CVData | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? migrateCV(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Migrates old single-language CV format to the current bilingual format.
// Returns null if the data structure is not a valid CV.
export function migrateCV(json: any): CVData | null {
  if (!json?.personalInfo || !json?.skills || !json?.experience || !json?.education) return null;

  const migrated: any = { ...json };
  if (!migrated.currentLanguage) migrated.currentLanguage = 'fr';

  const toBilingual = (val: any) =>
    typeof val === 'string' ? createMultiLangString({ fr: val, en: val }) : val;
  const toBilingualArray = (val: any) =>
    Array.isArray(val) ? createMultiLangArray({ fr: val, en: val }) : val;

  migrated.personalInfo = {
    ...migrated.personalInfo,
    title: toBilingual(migrated.personalInfo.title),
    summary: toBilingual(migrated.personalInfo.summary),
  };

  migrated.skills = migrated.skills.map((s: any) => ({
    ...s,
    name: toBilingual(s.name),
    items: toBilingual(s.items),
  }));

  migrated.experience = migrated.experience.map((exp: any) => ({
    ...exp,
    role: toBilingual(exp.role),
    startDate: toBilingual(exp.startDate),
    endDate: toBilingual(exp.endDate),
    description: toBilingualArray(exp.description),
  }));

  migrated.education = migrated.education.map((edu: any) => ({
    ...edu,
    degree: toBilingual(edu.degree),
    description: toBilingual(edu.description),
  }));

  if (Array.isArray(migrated.certifications)) {
    migrated.certifications = migrated.certifications.map((cert: any) => ({
      ...cert,
      title: toBilingual(cert.title),
    }));
  } else {
    migrated.certifications = [];
  }

  if (Array.isArray(migrated.languages)) {
    migrated.languages = toBilingualArray(migrated.languages);
  } else if (!migrated.languages) {
    migrated.languages = { fr: [], en: [] };
  }

  return migrated as CVData;
}
