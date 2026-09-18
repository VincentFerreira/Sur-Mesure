// Insights page — turns data already collected elsewhere in the app (Discovery
// discoveries, ATS scores, the Jobs pipeline) into metrics meant to answer two
// questions: where should I search, and what should I change on my CV. Each section
// owns its own empty state rather than a single page-level gate, since the three
// sections depend on different, independent data (discoveries / scored jobs / jobs
// with a status history).
//
// Deliberately NOT built here (documented so it isn't re-requested later):
// - CV-vs-CV comparison on the same job: not computable. Job.ats is overwritten in
//   place on every re-score (one active CV per job, no history) — there's no
//   Match-style entity keeping prior scores.
// - Average ATS score per CV: computable, but not shown — selection bias (you assign
//   your best CV to your best-fit jobs) would make it look meaningful while being
//   wrong.
// - Response rate by originating portal: Job.source is free text set at import time,
//   not a stable portal id — no reliable join back to ScrapedJob.portal today.
// - A literal "work-mode compatible" percentage: doesn't exist as a field: the
//   qualification LLM folds it into `score` plus a signal, not a separate boolean.
// - Auto-dismissed vs. human-dismissed discoveries: both produce status 'dismissed' —
//   `fit !== 'low'` is used as an imperfect proxy for "was actually reviewed."
// - Trend lines over time: nothing historizes these aggregates.
import React, { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useJobsStore } from '../store/jobsStore';
import { useCvsStore } from '../store/cvsStore';
import { useScraperStore } from '../store/scraperStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { isJobStale } from '../lib/jobStale';
import { atsScoreDelta, topMissingKeywords, recurringFormattingIssues } from '../lib/insightsAts';
import {
  fitDistribution,
  reviewConversion,
  portalYield,
  geographyBreakdown,
  shouldNudgeRemoteMismatch,
} from '../lib/insightsDiscovery';
import { tallySignalThemes } from '../lib/insightsSignals';
import { computeFunnel } from '../lib/insightsFunnel';
import AtsScoreDeltaCard from '../components/insights/AtsScoreDeltaCard';
import MissingKeywordsCard from '../components/insights/MissingKeywordsCard';
import FormattingChecksCard from '../components/insights/FormattingChecksCard';
import FitDistributionCard from '../components/insights/FitDistributionCard';
import SignalThemesCard from '../components/insights/SignalThemesCard';
import PortalYieldCard from '../components/insights/PortalYieldCard';
import GeographyCard from '../components/insights/GeographyCard';
import FunnelCard from '../components/insights/FunnelCard';
import StatTile from '../components/insights/StatTile';

const InsightsPage: React.FC = () => {
  const { jobs, loading: jobsLoading, fetchJobs } = useJobsStore();
  const { cvs, loading: cvsLoading, fetchCvs } = useCvsStore();
  const { candidates, loading: candidatesLoading, fetchCandidates } = useScraperStore();
  const { preferences, fetchPreferences } = usePreferencesStore();

  useEffect(() => {
    fetchJobs();
    fetchCvs();
    fetchCandidates(); // no status filter — need 'dismissed'/'imported' too, not just 'new'
    fetchPreferences();
  }, [fetchJobs, fetchCvs, fetchCandidates, fetchPreferences]);

  // Section A — Steer the search
  const distribution = useMemo(() => fitDistribution(candidates), [candidates]);
  const reviews = useMemo(() => [reviewConversion(candidates, 'high'), reviewConversion(candidates, 'medium')], [candidates]);
  const negativeSignals = useMemo(() => tallySignalThemes(candidates, 'negative'), [candidates]);
  const positiveSignals = useMemo(() => tallySignalThemes(candidates, 'positive'), [candidates]);
  const portals = useMemo(() => portalYield(candidates), [candidates]);
  const geography = useMemo(() => geographyBreakdown(candidates), [candidates]);
  const remoteNudge = shouldNudgeRemoteMismatch(geography.remoteShare, preferences?.workModes ?? []);

  // Section B — Tune the CV
  const scoredJobs = useMemo(() => jobs.filter((j) => j.ats), [jobs]);
  const cvsById = useMemo(() => new Map(cvs.map((cv) => [cv.id, cv])), [cvs]);
  const staleCount = useMemo(
    () => scoredJobs.filter((j) => isJobStale(j, j.cvId ? cvsById.get(j.cvId) : undefined)).length,
    [scoredJobs, cvsById]
  );
  const scoreDelta = useMemo(() => atsScoreDelta(jobs), [jobs]);
  const missingKeywords = useMemo(() => topMissingKeywords(jobs), [jobs]);
  const formattingIssues = useMemo(() => recurringFormattingIssues(jobs), [jobs]);

  // Section C — Conversion pipeline
  const funnel = useMemo(() => computeFunnel(jobs), [jobs]);

  const loading =
    (jobsLoading && jobs.length === 0) || (cvsLoading && cvs.length === 0) || (candidatesLoading && candidates.length === 0);
  const appliedCount = funnel.stages.find((s) => s.stage === 'applied')?.reachedCount ?? 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="insights-page">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-xl font-bold text-slate-800">Insights</h1>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            testId="insight-stat-discovered"
            value={jobsLoading || candidatesLoading ? '—' : distribution.total}
            label="jobs discovered"
            to="/job-search"
          />
          <StatTile
            testId="insight-stat-high-fit"
            value={candidatesLoading ? '—' : distribution.high}
            label="high-fit jobs"
            to="/job-search"
          />
          <StatTile
            testId="insight-stat-ats-avg"
            value={jobsLoading ? '—' : (scoreDelta.avgOverall ?? '—')}
            label={`avg ATS score (${scoreDelta.scoredCount} job${scoreDelta.scoredCount > 1 ? 's' : ''})`}
            to="/jobs"
          />
          <StatTile testId="insight-stat-applied" value={jobsLoading ? '—' : appliedCount} label="applications sent" to="/jobs" />
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && (
          <section data-testid="insights-section-search" className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-600">Steer the search</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {distribution.total} job{distribution.total > 1 ? 's' : ''} discovered ·{' '}
                {distribution.total - distribution.unqualified} qualified ·{' '}
                {distribution.unqualified} not qualified
              </p>
            </div>
            {distribution.total === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-sm text-slate-400" data-testid="insight-empty-search">
                  No jobs discovered yet.{' '}
                  <Link to="/job-search" className="text-indigo-600 hover:text-indigo-800 font-medium">
                    Run a search
                  </Link>
                </p>
              </div>
            ) : distribution.total - distribution.unqualified === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-sm text-slate-400">
                  No jobs qualified yet.{' '}
                  <Link to="/job-search" className="text-indigo-600 hover:text-indigo-800 font-medium">
                    Run another search
                  </Link>{' '}
                  so new jobs get scored.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FitDistributionCard distribution={distribution} reviews={reviews} />
                <PortalYieldCard result={portals} />
                <SignalThemesCard
                  title="Recurring market blockers"
                  testId="insight-card-signals-negative"
                  emptyTestId="insight-empty-signals-negative"
                  polarity="negative"
                  result={negativeSignals}
                  barClassName="bg-amber-400"
                />
                <SignalThemesCard
                  title="Recurring strengths"
                  testId="insight-card-signals-positive"
                  emptyTestId="insight-empty-signals-positive"
                  polarity="positive"
                  result={positiveSignals}
                  barClassName="bg-emerald-400"
                />
                <GeographyCard
                  geography={geography}
                  configuredLocations={preferences?.locations ?? []}
                  showRemoteMismatchNudge={remoteNudge}
                />
              </div>
            )}
          </section>
        )}

        {!loading && (
          <section data-testid="insights-section-cv" className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-600">Tune the CV</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {scoredJobs.length} job{scoredJobs.length > 1 ? 's' : ''} scored
                {staleCount > 0 && ` · ${staleCount} stale score${staleCount > 1 ? 's' : ''} (CV changed since)`}
              </p>
            </div>
            {scoredJobs.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-sm text-slate-400" data-testid="insight-empty-cv">
                  No job scored yet.{' '}
                  <Link to="/jobs" className="text-indigo-600 hover:text-indigo-800 font-medium">
                    Compute an ATS score
                  </Link>{' '}
                  on a job to see what to tune in your CV.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AtsScoreDeltaCard delta={scoreDelta} />
                <FormattingChecksCard rows={formattingIssues} />
                <MissingKeywordsCard rows={missingKeywords} />
              </div>
            )}
          </section>
        )}

        {!loading && (
          <section data-testid="insights-section-pipeline" className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-600">Conversion pipeline</h2>
            </div>
            <FunnelCard funnel={funnel} />
          </section>
        )}
      </div>
    </div>
  );
};

export default InsightsPage;
