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

// Singleton (not a collection like Cv/Job/Company): exactly one record, read/written
// at a fixed server-side path, no `id`. Consumed by the job-scraping feature (see
// ScrapedJob below) to parameterize what to search for.
export interface SearchPreferences {
  jobTitles: string[];
  locations: string[];
  workModes: JobWorkMode[];
  minGrossAnnualSalary?: number;
  cvId?: string;
  updatedAt: string | null; // ISO; null until the first save ever succeeds
}

// Singleton (like SearchPreferences above): exactly one record, read/written at a
// fixed server-side path, no `id`. Holds editor-wide LaTeX rendering preferences
// (currently just the chosen font, see lib/fonts.ts) — not part of CVData because it
// applies across every CV, not per-resume.
export interface TemplateSettings {
  fontId: string;
  updatedAt: string | null; // ISO; set on the first save (row is seeded with a default at creation)
}

export const SCRAPED_JOB_STATUSES = ['new', 'dismissed', 'imported'] as const;
export type ScrapedJobStatus = (typeof SCRAPED_JOB_STATUSES)[number];

export const SCRAPED_JOB_FITS = ['high', 'medium', 'low'] as const;
export type ScrapedJobFit = (typeof SCRAPED_JOB_FITS)[number];

export const SCRAPED_SIGNAL_POLARITIES = ['positive', 'negative', 'neutral'] as const;
export type ScrapedSignalPolarity = (typeof SCRAPED_SIGNAL_POLARITIES)[number];

// A short, chip-sized reason behind a candidate's score (e.g. {label: "Playwright",
// polarity: "positive"}), returned by the AI qualification pass alongside `score` —
// gives the review UI something to show besides a bare number, and gives us a way to
// debug the judge's reasoning.
export interface ScrapedSignal {
  label: string;
  polarity: ScrapedSignalPolarity;
}

/**
 * A job posting found by a scraper portal, staged for human review. Deliberately
 * separate from `Job` — nothing here is a real, tracked application until the user
 * explicitly imports it (mirrors ImportJobDialog's "extraction never saves anything
 * by itself" rule).
 */
export interface ScrapedJob {
  id: string;
  dedupeKey: string; // company+title slug — vestigial, kept only for its pre-existing DB constraint; fingerprint is the real cross-run identity now
  fingerprint: string; // portal:externalId when the portal provides one, else a hash of company+title+department — see server/scraperFingerprint.js
  externalId?: string; // stable per-posting id from the portal's own API, when available (France Travail, Arbeitnow); absent otherwise
  portal: string; // portal id, e.g. 'france_travail'
  title: string;
  company: string;
  location?: string;
  department?: string; // numeric French department code extracted from `location` at ingest, e.g. "92"
  isRemote: boolean; // derived from `location` at ingest — always computable, defaults false
  contractType?: JobContractType;
  salaryRange?: string;
  url: string;
  postedDate?: string; // ISO date, from the portal
  descriptionRaw?: string;
  // Set by the AI qualification pass (server/scrapers/claudeCli.js qualifyAll, via
  // services/scraperService.ts qualifyScrapedJobs) run right after a scrape: judges
  // this candidate against the user's actual configured job titles (not the AI-expanded
  // search keywords, which are deliberately broader). `fit` is derived server-side from
  // `score` (see server/scrapers/scraperFit.js) — the client never re-thresholds `score`
  // itself. 'low' fit candidates are auto-dismissed so the default New view stays
  // on-topic. `score`/`signals` are absent for candidates qualified before this field
  // existed, or when the qualification pass failed for them — no backfill, these
  // candidates are short-lived (reviewed and cleared quickly), unlike e.g. CVs.
  fit?: ScrapedJobFit;
  score?: number; // 0-100
  signals?: ScrapedSignal[];
  status: ScrapedJobStatus;
  // Optional, user-typed explanation set when dismissing this candidate (see
  // components/scraper/DismissReasonPrompt.tsx) — never required, and settable
  // independently of `status` (a follow-up PATCH can add it after the fact). Feeds
  // server/scraperCandidatesStore.js's listRejectionReasons, which
  // server/scrapers/claudeCli.js's qualifyAll injects into future scoring prompts so
  // similar future postings score lower instead of resurfacing unfiltered.
  dismissReason?: string;
  importedJobId?: string; // set once promoted to a real Job
  firstSeenAt: string; // ISO — set once, never changed
  lastSeenAt: string; // ISO — bumped every time this exact posting (by fingerprint) reappears in a scrape run
  viewedAt?: string; // ISO — set once, the first time a human actually looks at this row; never reset. Absent/null = "inédite"
  updatedAt: string; // ISO
}

// One WebSearch/WebFetch tool call narrated live from server/scrapers/claudeCli.js's
// searchAll (server/scraperProgress.js) while POST /api/scraper/run is in flight —
// polled by store/scraperStore.ts to show what's actually happening instead of a
// static spinner for what can take several minutes.
export type ScraperProgressEventStatus = 'pending' | 'done' | 'failed';

export interface ScraperProgressEvent {
  seq: number; // monotonically increasing — poll GET /run/progress?sinceSeq= with the last one seen
  at: string; // ISO
  message: string;
  status: ScraperProgressEventStatus;
}

export interface ScraperProgress {
  active: boolean;
  events: ScraperProgressEvent[];
}

export const AI_CALL_PROVIDERS = ['gemini', 'claude', 'claude_cli', 'fake'] as const;
export type AiCallProvider = (typeof AI_CALL_PROVIDERS)[number];

export const AI_CALL_OPERATIONS = ['parse_cv', 'analyze_ats', 'extract_job', 'expand_keywords', 'qualify', 'search_all'] as const;
export type AiCallOperation = (typeof AI_CALL_OPERATIONS)[number];

export const AI_CALL_STATUSES = ['success', 'error'] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

/**
 * One logged AI call — client-side Gemini/Claude SDK call (services/aiService.ts) or
 * server-side `claude` CLI invocation (server/scrapers/claudeCli.js) — for the
 * Observability page. Fire-and-forget: logging a call must never affect the outcome of
 * the underlying AI request.
 */
export interface AiCall {
  id: string;
  createdAt: string; // ISO
  provider: AiCallProvider;
  operation: AiCallOperation;
  model?: string;
  durationMs: number;
  status: AiCallStatus;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  costUsd?: number; // only ever set by the claude_cli path, which can report it
  metadata?: Record<string, unknown>;
}

export interface AiCallStats {
  totalCalls: number;
  totalTokens: number;
  avgDurationMs: number;
  errorRate: number; // 0-1
  byProvider: Record<string, { calls: number; tokens: number; errors: number }>;
  byOperation: Record<string, { calls: number; tokens: number; errors: number }>;
}
