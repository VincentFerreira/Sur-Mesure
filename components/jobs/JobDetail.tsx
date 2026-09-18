import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Copy, ExternalLink, Loader2, Pencil, RotateCcw, Target, Trash2 } from 'lucide-react';
import { Job, JOB_STATUSES, JobStatus } from '../../types';
import { getJob } from '../../services/jobService';
import { useJobsStore } from '../../store/jobsStore';
import { useCvsStore } from '../../store/cvsStore';
import { ApiError } from '../../services/apiClient';
import { isJobStale } from '../../lib/jobStale';
import { ATS_PROMPT_VERSION } from '../../lib/atsConstants';
import { loadCV, duplicateCV } from '../../services/cvStorageService';
import { AIProvider, analyzeATS, atsProviderModel } from '../../services/aiService';
import { STATUS_META } from './statusMeta';
import JobTimeline from './JobTimeline';
import JobForm from './JobForm';
import AtsReport from '../matches/AtsReport';

const FAKE_PROVIDER_ENABLED = import.meta.env.VITE_ATS_PROVIDER === 'fake';
const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'gemini', label: '🤖 Gemini' },
  { value: 'claude', label: '🧠 Claude' },
  ...(FAKE_PROVIDER_ENABLED ? [{ value: 'fake' as AIProvider, label: '🧪 Fake' }] : []),
];

interface Props {
  jobId: string;
}

const JobDetail: React.FC<Props> = ({ jobId }) => {
  const navigate = useNavigate();
  const { patchJob, removeJob, scoreJob } = useJobsStore();
  const { cvs, fetchCvs } = useCvsStore();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [provider, setProvider] = useState<AIProvider>(FAKE_PROVIDER_ENABLED ? 'fake' : 'gemini');
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    getJob(jobId)
      .then(setJob)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    if (cvs.length === 0) fetchCvs();
  }, [cvs.length, fetchCvs]);

  const cv = job?.cvId ? cvs.find((c) => c.id === job.cvId) : undefined;
  const stale = job ? isJobStale(job, cv) : false;

  const analysis = job?.ats?.analysis;
  const missingCritical = (analysis?.criticalKeywords ?? []).filter((k) => k.status === 'missing').length;
  const failedFormatting = (analysis?.formattingChecks ?? []).filter((c) => c.status === 'fail').length;
  const scoreGap = analysis ? analysis.estimatedNewScore - analysis.overallScore : 0;
  const canImprove = !!(analysis && job?.cvId && (missingCritical > 0 || failedFormatting > 0 || scoreGap > 0));

  const handleStatusChange = async (status: JobStatus) => {
    if (!job) return;
    setStatusError(null);
    try {
      const updated = await patchJob(job.id, { status });
      setJob(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cv_required_for_applied') {
        setStatusError('Assign a CV below before marking this job as applied.');
      } else {
        setStatusError('Unable to update status.');
      }
    }
  };

  const handleCvAssign = async (cvId: string) => {
    if (!job) return;
    try {
      const updated = await patchJob(job.id, { cvId: cvId || undefined });
      setJob(updated);
    } catch {
      setStatusError('Unable to assign this CV.');
    }
  };

  const handleComputeScore = async () => {
    if (!job?.cvId) return;
    setScoring(true);
    setScoreError(null);
    try {
      const cvRecord = await loadCV(job.cvId);
      const analysis = await analyzeATS(cvRecord.data, job.descriptionRaw, provider);
      const updated = await scoreJob(job.id, {
        cvId: job.cvId,
        cvContentHash: cvRecord.contentHash,
        ats: {
          analysis,
          provider,
          model: atsProviderModel(provider),
          promptVersion: ATS_PROMPT_VERSION,
          jobDescriptionHash: '', // server recomputes this from descriptionRaw
        },
      });
      setJob(updated);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : 'Unable to compute the score.');
    } finally {
      setScoring(false);
    }
  };

  const handleDuplicateCv = async () => {
    if (!job?.cvId || !cv) return;
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const copy = await duplicateCV(cv.id, `${cv.label} — ${job.company}`);
      navigate(`/cvs/${copy.id}`);
    } catch {
      setDuplicateError('Unable to duplicate this CV.');
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    await removeJob(job.id);
    navigate('/jobs');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (notFound || !job) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-slate-400">
          <p className="mb-1 text-slate-500 font-medium">Job not found.</p>
          <button onClick={() => navigate('/jobs')} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            Back to Jobs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="job-detail">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={() => navigate('/jobs')} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 mb-4 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Jobs
        </button>

        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{job.title}</h1>
            <p className="text-slate-500 flex items-center gap-1.5">
              {job.company}
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:text-indigo-700">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={handleDelete}
              onBlur={() => setDeleteConfirm(false)}
              className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 transition-colors ${
                deleteConfirm ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-slate-500 border-slate-200 hover:text-red-600'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteConfirm ? 'Confirm?' : 'Delete'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4 mb-6">
          <select
            value={job.status}
            onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
            data-testid="status-select"
            className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${STATUS_META[job.status].className}`}
          >
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
          {job.location && <span className="text-xs text-slate-400">{job.location}</span>}
          {job.workMode && <span className="text-xs text-slate-400">· {job.workMode}</span>}
          {job.contractType && <span className="text-xs text-slate-400">· {job.contractType}</span>}
          {stale && (
            <span data-testid="stale-badge" className="text-xs font-medium text-amber-600 bg-amber-50 rounded-full px-2.5 py-1">
              Score obsolete
            </span>
          )}
        </div>

        {statusError && (
          <div className="flex items-start gap-2 text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4" data-testid="status-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {statusError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">CV sent</p>
          <div className="flex items-center gap-2">
            <select
              value={job.cvId ?? ''}
              onChange={(e) => handleCvAssign(e.target.value)}
              data-testid="cv-select"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">— None —</option>
              {cvs.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {job.cvId && (
              <button
                onClick={handleDuplicateCv}
                disabled={duplicating}
                data-testid="duplicate-cv-button"
                className="flex items-center gap-1.5 shrink-0 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-2 disabled:opacity-50 transition-colors"
              >
                {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                Duplicate CV &amp; adapt
              </button>
            )}
          </div>
          {duplicateError && <p className="text-red-600 text-xs mt-2">{duplicateError}</p>}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl mb-6 overflow-hidden" data-testid="score-section">
          <div className="p-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">CV & score</p>
            {job.cvId && (
              <div className="flex items-center gap-2">
                {PROVIDERS.length > 1 && (
                  <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                    {PROVIDERS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setProvider(value)}
                        data-testid={`provider-${value}`}
                        className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                          provider === value ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleComputeScore}
                  disabled={scoring}
                  data-testid="compute-score-button"
                  className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {scoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : job.ats ? <RotateCcw className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
                  {job.ats ? 'Recalculate' : 'Compute score'}
                </button>
              </div>
            )}
          </div>

          {!job.cvId && (
            <p className="px-4 pb-4 text-sm text-slate-400">Assign a CV above to compute a score.</p>
          )}

          {scoreError && (
            <div className="mx-4 mb-4 flex items-start gap-2 text-red-700 text-sm bg-red-50 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {scoreError}
            </div>
          )}

          {stale && job.ats && (
            <div className="mx-4 mb-4 flex items-start gap-2 text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              This score was computed against a different version of the CV. Recalculate to refresh it.
            </div>
          )}

          {canImprove && analysis && (
            <div className="mx-4 mb-4 flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3" data-testid="improve-score-cta">
              <div className="text-sm text-indigo-900">
                <p className="font-semibold">Improve this score</p>
                <p className="text-xs text-indigo-700 mt-0.5">
                  {[
                    missingCritical > 0 ? `${missingCritical} missing critical keyword${missingCritical > 1 ? 's' : ''}` : null,
                    failedFormatting > 0 ? `${failedFormatting} formatting issue${failedFormatting > 1 ? 's' : ''}` : null,
                    scoreGap > 0 ? `up to ${analysis.estimatedNewScore}/100 after fixes` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Link
                to={`/cvs/${job.cvId}`}
                state={{ activeTab: 'ats', atsJobDescription: job.descriptionRaw, atsResult: analysis }}
                className="flex items-center gap-1.5 shrink-0 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit CV
              </Link>
            </div>
          )}

          {job.ats && <AtsReport analysis={job.ats.analysis} />}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Job description</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{job.descriptionRaw}</p>
          {job.keywords && job.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3" data-testid="job-keywords">
              {job.keywords.map((kw) => (
                <span key={kw} className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{kw}</span>
              ))}
            </div>
          )}
        </div>

        {job.notes && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{job.notes}</p>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Timeline</p>
          <JobTimeline events={job.events} />
        </div>
      </div>

      <JobForm
        open={editOpen}
        initial={job}
        onClose={() => setEditOpen(false)}
        onSubmit={async (input) => {
          const updated = await patchJob(job.id, input);
          setJob(updated);
        }}
      />
    </div>
  );
};

export default JobDetail;
