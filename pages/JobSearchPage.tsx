import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Radar } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useScraperStore } from '../store/scraperStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useJobsStore } from '../store/jobsStore';
import { ScrapedJob, ScrapedJobStatus } from '../types';
import JobForm from '../components/jobs/JobForm';
import ScrapedJobsList from '../components/scraper/ScrapedJobsList';
import { formatRelativeDate, portalLabel } from '../components/scraper/scrapedJobMeta';
import { CreateJobInput } from '../services/jobService';
import { expandSearchKeywords, qualifyScrapedJobs } from '../services/scraperService';
import { serializeCVForATS } from '../services/aiService';
import { loadCV } from '../services/cvStorageService';

const TABS: ScrapedJobStatus[] = ['new', 'dismissed', 'imported'];
const TAB_LABELS: Record<ScrapedJobStatus, string> = { new: 'Nouvelles', dismissed: 'Écartées', imported: 'Importées' };

type PipelineStage = 'idle' | 'expanding' | 'searching' | 'qualifying';
const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Lancer un scrape',
  expanding: 'Élargissement des mots-clés…',
  searching: 'Recherche…',
  qualifying: 'Analyse des résultats…',
};

const JobSearchPage: React.FC = () => {
  const {
    candidates,
    loading,
    error,
    lastRunReport,
    fetchCandidates,
    runScrape,
    dismissCandidate,
    importCandidate,
    setCandidateQualification,
  } = useScraperStore();
  const { preferences, fetchPreferences } = usePreferencesStore();
  const { addJob } = useJobsStore();
  const [tab, setTab] = useState<ScrapedJobStatus>('new');
  const [importing, setImporting] = useState<ScrapedJob | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');
  // JobForm stays mounted (returns null) while closed, so its useState initializers only
  // run once — bump this on every open (same trick as CompaniesPage's formSession) so
  // reopening it for a different candidate always starts from that candidate's fields.
  const [formSession, setFormSession] = useState(0);

  useEffect(() => {
    fetchCandidates();
    fetchPreferences();
  }, [fetchCandidates, fetchPreferences]);

  const visibleCandidates = useMemo(() => candidates.filter((c) => c.status === tab), [candidates, tab]);
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
          <h1 className="text-xl font-bold text-slate-800">Découverte</h1>
          <button
            onClick={handleRunSearch}
            disabled={stage !== 'idle' || !hasJobTitles}
            data-testid="run-scrape-button"
            title={hasJobTitles ? undefined : 'Renseignez au moins un intitulé de poste dans les Préférences'}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {stage !== 'idle' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            {STAGE_LABELS[stage]}
          </button>
        </div>

        {lastScrapeAt && (
          <p className="text-xs text-slate-400 mb-4">
            Dernier scrape {formatRelativeDate(lastScrapeAt)} · {candidates.length} offres
          </p>
        )}

        {!hasJobTitles && (
          <p className="text-sm text-slate-400 mb-4">
            Aucun intitulé de poste configuré.{' '}
            <Link to="/preferences" className="text-indigo-600 hover:text-indigo-800 font-medium">
              Renseignez vos préférences de recherche
            </Link>{' '}
            pour lancer une recherche.
          </p>
        )}

        {lastRunReport && (
          <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4" data-testid="scrape-run-report">
            {lastRunReport.map((entry) => (
              <p key={entry.portal} className={entry.error ? 'text-amber-700' : 'text-slate-600'}>
                {portalLabel(entry.portal)}: {entry.error ? `unavailable (${entry.error})` : `${entry.count} found`}
              </p>
            ))}
          </div>
        )}

        {error && <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                data-testid={`scraped-jobs-tab-${t}`}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {TAB_LABELS[t]} {tabCounts[t]}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">↑↓ Fit, puis récence</span>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && visibleCandidates.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Radar className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-medium">Aucune offre {TAB_LABELS[tab].toLowerCase()}.</p>
          </div>
        )}

        {!loading && visibleCandidates.length > 0 && (
          <ScrapedJobsList candidates={visibleCandidates} onImport={openImport} onDismiss={(c) => dismissCandidate(c.id)} />
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
    </div>
  );
};

export default JobSearchPage;
