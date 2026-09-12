export type { Language } from './lib/i18n';

import type { Language } from './lib/i18n';

export type MultiLangString = Partial<Record<Language, string>>;
export type MultiLangStringArray = Partial<Record<Language, string[]>>;

export interface CVData {
  currentLanguage: Language;
  personalInfo: {
    firstName: string;
    lastName: string;
    title: MultiLangString;
    email: string;
    medium: string;
    location: string;
    linkedin: string;
    github: string;
    photo: string | null;
    summary: MultiLangString;
  };
  skills: SkillCategory[];
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: CertificationItem[];
  languages: MultiLangStringArray;
}

export interface SkillCategory {
  id: string;
  name: MultiLangString;
  items: MultiLangString;
}

export interface ExperienceItem {
  id: string;
  role: MultiLangString;
  company: string;
  location: string;
  startDate: MultiLangString;
  endDate: MultiLangString;
  description: MultiLangStringArray;
  techStack: string;
}

export interface EducationItem {
  id: string;
  school: string;
  degree: MultiLangString;
  location: string;
  startDate: string;
  endDate: string;
  description: MultiLangString;
}

export interface CertificationItem {
  id: string;
  title: MultiLangString;
  issuer: string;
  year: string;
}

export interface ATSKeyword {
  keyword: string;
  status: 'present' | 'missing' | 'partial';
  frequency: number;
  importance: 'critical' | 'important';
  analysis: string;
}

export interface ATSFormattingCheck {
  label: string;
  status: 'pass' | 'fail' | 'warning';
  detail?: string;
}

export interface ATSRecommendation {
  section: string;
  issue: string;
  before?: string;
  after?: string;
}

export interface ATSAnalysisResult {
  overallScore: number;
  estimatedNewScore: number;
  criticalKeywords: ATSKeyword[];
  importantKeywords: ATSKeyword[];
  formattingChecks: ATSFormattingCheck[];
  recommendations: ATSRecommendation[];
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────
// CVthèque / Jobs / ATS matching (docs/spec-pipeline-postes.md)
// ─────────────────────────────────────────────────────────────────────────

/** Cv metadata as stored server-side (everything except the CV content itself). */
export interface CvMeta {
  id: string;
  label: string;
  language: Language;
  tags: string[];
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: string;
}

/** Full Cv record, as returned by GET /api/cvs/:id. */
export interface CvRecord extends CvMeta {
  data: CVData;
}

export const JOB_STATUSES = [
  'lead',
  'to_apply',
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'archived',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobWorkMode = 'onsite' | 'hybrid' | 'remote';
export type JobContractType = 'CDI' | 'CDD' | 'freelance' | 'internship';

export interface JobEvent {
  id: string;
  at: string; // ISO
  type: 'status_change' | 'note' | 'follow_up' | 'interview' | 'match_submitted';
  from?: JobStatus;
  to?: JobStatus;
  comment?: string;
}

/**
 * Score for one CV against one job — embedded directly on the Job (§ "one active CV per job").
 * Wraps the same `ATSAnalysisResult` the standalone ATS Checker produces, so the two screens
 * can share one rendering component (`AtsReport`) instead of maintaining two report shapes.
 */
export interface AtsResult {
  analysis: ATSAnalysisResult;
  provider: 'claude' | 'gemini' | 'fake';
  model: string;
  promptVersion: string;
  jobDescriptionHash: string;
}

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface Company {
  id: string;
  name: string;
  website?: string;
  location?: string;
  size?: CompanySize;
  remoteFriendly?: boolean;
  next40?: boolean;
  frenchTech120?: boolean;
  notes?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface Job {
  id: string;
  company: string;
  companyId?: string;
  title: string;
  status: JobStatus;
  priority: 1 | 2 | 3;
  location?: string;
  workMode?: JobWorkMode;
  contractType?: JobContractType;
  salaryRange?: string;
  url?: string;
  source?: string;
  contactName?: string;
  descriptionRaw: string;
  keywords: string[];
  cvId?: string;
  cvContentHash?: string;
  ats?: AtsResult;
  atsComputedAt?: string;
  submitted: boolean;
  submittedAt?: string;
  exportedPdfPath?: string;
  appliedAt?: string;
  nextActionAt?: string;
  nextActionLabel?: string;
  notes?: string;
  events: JobEvent[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
