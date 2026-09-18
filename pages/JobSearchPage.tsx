import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Radar, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useScraperStore } from '../store/scraperStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useJobsStore } from '../store/jobsStore';
import { ScrapedJob, ScrapedJobStatus } from '../types';
import JobForm from '../components/jobs/JobForm';
import ScrapedJobsList from '../components/scraper/ScrapedJobsList';
import DismissReasonToast from '../components/scraper/DismissReasonToast';
import { formatRelativeDate, portalLabel } from '../components/scraper/scrapedJobMeta';
import { CreateJobInput } from '../services/jobService';
import { expandSearchKeywords, qualifyScrapedJobs } from '../services/scraperService';
import { serializeCVForATS } from '../services/aiService';
import { loadCV } from '../services/cvStorageService';

const TABS: ScrapedJobStatus[] = ['new', 'dismissed', 'imported'];
const TAB_LABELS: Record<ScrapedJobStatus, string> = { new: 'New', dismissed: 'Dismissed', imported: 'Imported' };

type PipelineStage = 'idle' | 'expanding' | 'searching' | 'qualifying';
const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Run a scrape',
  expanding: 'Expanding keywords…',
  searching: 'Searching…',
  qualifying: 'Analyzing results…',
};

const JobSearchPage: React.FC = () => {
  const {
    candidates,
    loading,
    error,
    lastRunReport,
    lastRunCreated,
    lastDismissed,
    progressEvents,
    fetchCandidates,
    runScrape,
    dismissCandidate,
    setDismissReason,
    clearLastDismissed,
    importCandidate,
    setCandidateQualification,
    markCandidatesViewed,
  } = useScraperStore();
  const { preferences, fetchPreferences } = usePreferencesStore();
  const { addJob } = useJobsStore();
  const [tab, setTab] = useState<ScrapedJobStatus>('new');
  const [importing, setImporting] = useState<ScrapedJob | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');
  // Set only by the post-scrape banner's "View the N" button — a passive affordance,
  // not an independent persistent toggle, so clicking any tab button directly resets it.
  const [unviewedOnly, setUnviewedOnly] = useState(false);
  // JobForm stays mounted (returns null) while closed, so its useState initializers only
  // run once — bump this on every open (same trick as CompaniesPage's formSession) so
  // reopening it for a different candidate always starts from that candidate's fields.
  const [formSession, setFormSession] = useState(0);

  useEffect(() => {
    fetchCandidates();
    fetchPreferences();
  }, [fetchCandidates, fetchPreferences]);

  const visibleCandidates = useMemo(
    () => candidates.filter((c) => c.status === tab && (!unviewedOnly || !c.viewedAt)),
    [candidates, tab, unviewedOnly]
  );
  const tabCounts = useMemo(() => {
    const counts: Record<ScrapedJobStatus, number> = { new: 0, dismissed: 0, imported: 0 };
    for (const c of candidates) counts[c.status] += 1;
    return counts;
  }, [candidates]);
  const hasJobTitles = (preferences?.jobTitles.length ?? 0) > 0;
  const lastScrapeAt = useMemo(
    () => candidates.reduce((max, c) => (c.firstSeenAt > max ? c.firstSeenAt : max), ''),
    [candidates]
  );

  // "Unseen" = status 'new' AND never viewed — matches exactly the population the
  // "New" tab already shows, and is where "View the N" naturally navigates to.
  // Scoping to status 'new' (not "any unviewed") deliberately excludes an
  // already-dismissed/imported candidate: nobody still needs to act on it, even if
  // literally nobody's eyes were ever on it.
  const unviewedNew = useMemo(() => candidates.filter((c) => c.status === 'new' && !c.viewedAt), [candidates]);
  const unviewedNewHighFit = useMemo(() => unviewedNew.filter((c) => c.fit === 'high').length, [unviewedNew]);
  const totalReturnedThisRun = useMemo(() => lastRunReport?.reduce((sum, e) => sum + (e.count ?? 0), 0) ?? 0, [lastRunReport]);
  const alreadyKnownThisRun = totalReturnedThisRun - (lastRunCreated?.length ?? 0);
  const newByPortal = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of lastRunCreated ?? []) counts.set(c.portal, (counts.get(c.portal) ?? 0) + 1);
    return [...counts.entries()];
  }, [lastRunCreated]);

  const openImport = (candidate: ScrapedJob) => {
    setImporting(candidate);
    setFormSession((s) => s + 1);
  };

  const closeImport = () => setImporting(null);

  // JobForm itself calls onClose() once this resolves — no need to do it here too.
  const handleSubmit = async (input: CreateJobInput) => {
    if (!importing) return;
    const job = await addJob(input);
    await importCandidate(importing.id, job.id);
  };

  // Three-step pipeline. All three AI steps now run server-side via the `claude` CLI
  // (server/scrapers/claudeCli.js) — the user's existing Claude Code auth, not a
  // separate billed API key with its own rate limit:
  // 1. Widen preferences.jobTitles into more search keywords (better recall) —
  //    POST /api/scraper/expand-keywords.
  // 2. Run the actual scrape — server-side this fans out to France Travail,
  //    Arbeitnow, Freehire, and a `claude` CLI invocation using Claude Code's own
  //    WebSearch/WebFetch tools for boards with no structured API, mirroring
  //    ai-job-search's WebSearch fallback.
  // 3. Judge each new candidate against the *original* (non-widened) job titles,
  //    locations and work modes, and — when preferences.cvId is set — the actual CV
  //    content (same serialization the ATS Checker uses), for a genuine CV-to-posting
  //    fit instead of keyword matching alone — POST /api/scraper/qualify. 'low' fit
  //    auto-dismisses so the default New view stays on-topic.
  // Steps 1 and 3 degrade gracefully: if a call (or the CV load) fails, the pipeline
  // falls back to the configured titles / title-and-location-only fit / leaves
  // candidates untagged, rather than losing the run.
  const handleRunSearch = async () => {
    if (!preferences || preferences.jobTitles.length === 0) return;

    setStage('expanding');
    let searchTitles = preferences.jobTitles;
    try {
      searchTitles = await expandSearchKeywords(preferences.jobTitles);
    } catch (err) {
      console.error('Keyword expansion failed; searching with the configured titles only.', err);
    }

    setStage('searching');
    let result;
    try {
      result = await runScrape(searchTitles);
    } catch {
      setStage('idle');
      return; // runScrape already recorded the error in the store.
    }

    if (result.created.length > 0) {
      setStage('qualifying');
      let cvText: string | undefined;
      if (preferences.cvId) {
        try {
          const cvRecord = await loadCV(preferences.cvId);
          cvText = serializeCVForATS(cvRecord.data);
        } catch (err) {
          console.error('Could not load the linked CV; qualifying by title/location only.', err);
        }
      }
      try {
        const results = await qualifyScrapedJobs(
          result.created.map((c) => ({
            id: c.id,
            title: c.title,
            company: c.company,
            location: c.location,
            descriptionRaw: c.descriptionRaw,
          })),
          preferences.jobTitles,
          preferences.locations,
          cvText,
          preferences.workModes
        );
        await Promise.all(
          result.created.map((c) => (results[c.id] ? setCandidateQualification(c.id, results[c.id]) : Promise.resolve(undefined)))
        );
      } catch (err) {
        console.error('Qualification pass failed; new candidates were left unfiltered.', err);
      }
    }

    setStage('idle');
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="job-search-page">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-slate-800">Discovery</h1>
          <button
            onClick={handleRunSearch}
            disabled={stage !== 'idle' || !hasJobTitles}
            data-testid="run-scrape-button"
            title={hasJobTitles ? undefined : 'Fill in at least one job title in Preferences'}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {stage !== 'idle' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            {STAGE_LABELS[stage]}
          </button>
        </div>

        {stage === 'searching' && progressEvents.length > 0 && (
          <div
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 space-y-1"
            data-testid="scrape-progress-feed"
          >
            {progressEvents.map((e) => (
              <div key={e.seq} className="flex items-center gap-1.5 text-xs text-slate-500">
                {e.status === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" />}
                {e.status === 'done' && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
                {e.status === 'failed' && <X className="w-3 h-3 text-amber-500 shrink-0" />}
                <span className="truncate">{e.message}</span>
              </div>
            ))}
          </div>
        )}

        {lastScrapeAt && (
          <p className="text-xs text-slate-400 mb-4">
            Last scrape {formatRelativeDate(lastScrapeAt)} · {candidates.length} jobs
          </p>
        )}

        {!hasJobTitles && (
          <p className="text-sm text-slate-400 mb-4">
            No job title configured.{' '}
            <Link to="/preferences" className="text-indigo-600 hover:text-indigo-800 font-medium">
              Fill in your search preferences
            </Link>{' '}
            to run a search.
          </p>
        )}

        {lastRunReport?.some((e) => e.error) && (
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4" data-testid="scrape-run-errors">
            {lastRunReport
              .filter((e) => e.error)
              .map((e) => (
                <p key={e.portal}>
                  {portalLabel(e.portal)} unavailable ({e.error})
                </p>
              ))}
          </div>
        )}

        {lastRunReport && unviewedNew.length > 0 && (
          <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-3 mb-4" data-testid="unseen-banner">
            <p className="text-sm font-medium text-sky-900">
              {unviewedNew.length} new job{unviewedNew.length > 1 ? 's' : ''}, including{' '}
              {unviewedNewHighFit} high-fit match{unviewedNewHighFit > 1 ? 'es' : ''}
            </p>
            <p className="text-xs text-sky-700 mt-1">
              {totalReturnedThisRun} returned · {alreadyKnownThisRun} already known
              {newByPortal.length > 0 &&
                newByPortal.map(([portal, count]) => (
                  <React.Fragment key={portal}>
                    {' '}
                    · {portalLabel(portal)} {count}
                  </React.Fragment>
                ))}
            </p>
            <button
              onClick={() => {
                setTab('new');
                setUnviewedOnly(true);
              }}
              data-testid="view-unseen-button"
              className="text-xs font-semibold text-sky-700 underline mt-2"
            >
              View the {unviewedNew.length}
            </button>
          </div>
        )}

        {error && <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setUnviewedOnly(false);
                }}
                data-testid={`scraped-jobs-tab-${t}`}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {TAB_LABELS[t]} {tabCounts[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => markCandidatesViewed(visibleCandidates.filter((c) => !c.viewedAt).map((c) => c.id))}
              data-testid="mark-all-viewed-button"
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Mark all as viewed
            </button>
            <span className="text-xs text-slate-400">↑↓ Fit, then recency</span>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && visibleCandidates.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Radar className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-medium">No {TAB_LABELS[tab].toLowerCase()} job.</p>
          </div>
        )}

        {!loading && visibleCandidates.length > 0 && (
          <ScrapedJobsList
            candidates={visibleCandidates}
            onImport={openImport}
            onDismiss={(c) => dismissCandidate(c.id)}
            onMarkViewed={(id) => markCandidatesViewed([id])}
          />
        )}
      </div>

      <JobForm
        key={formSession}
        open={Boolean(importing)}
        initial={
          importing
            ? {
                company: importing.company,
                title: importing.title,
                location: importing.location,
                contractType: importing.contractType,
                salaryRange: importing.salaryRange,
                url: importing.url,
                source: portalLabel(importing.portal),
                descriptionRaw: importing.descriptionRaw ?? '',
              }
            : undefined
        }
        onClose={closeImport}
        onSubmit={handleSubmit}
      />

      {lastDismissed && (
        <DismissReasonToast
          title={lastDismissed.title}
          onSave={(reason) => setDismissReason(lastDismissed.id, reason)}
          onClose={clearLastDismissed}
        />
      )}
    </div>
  );
};

export default JobSearchPage;
