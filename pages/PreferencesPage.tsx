import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePreferencesStore } from '../store/preferencesStore';
import { useCvsStore } from '../store/cvsStore';
import { CvMeta, JobWorkMode, ScraperPortalId, SCRAPER_PORTAL_IDS, SearchPreferences } from '../types';
import { SavePreferencesInput } from '../services/preferencesService';
import TagInput, { TagInputHandle } from '../components/preferences/TagInput';

const WORK_MODE_OPTIONS: { value: JobWorkMode; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

// One line per server/scrapers/index.js portal id — kept here (not shared with the
// server) since this is presentation copy, not a validation rule.
const PORTAL_INFO: Record<ScraperPortalId, { label: string; description: string }> = {
  france_travail: {
    label: 'France Travail',
    description: 'Official French public job board API — the most reliable source for France, no rate-limit risk.',
  },
  arbeitnow: {
    label: 'Arbeitnow',
    description: 'International job aggregator, no API key required — widens the search beyond France.',
  },
  freehire: {
    label: 'FreeHire',
    description: 'Public aggregator across ~50 ATS platforms (Greenhouse, Lever, etc.) — company-published listings.',
  },
  claude_cli: {
    label: 'Claude web search',
    description: 'AI-powered web search for boards without a public API — slower and billed per use.',
  },
};

interface FormProps {
  initial: SearchPreferences;
  cvs: CvMeta[];
  onSave: (input: SavePreferencesInput) => Promise<SearchPreferences>;
}

const PreferencesForm: React.FC<FormProps> = ({ initial, cvs, onSave }) => {
  const [jobTitles, setJobTitles] = useState(initial.jobTitles);
  const [locations, setLocations] = useState(initial.locations);
  const [workModes, setWorkModes] = useState<JobWorkMode[]>(initial.workModes);
  const [minSalary, setMinSalary] = useState(initial.minGrossAnnualSalary != null ? String(initial.minGrossAnnualSalary) : '');
  const [cvId, setCvId] = useState(initial.cvId ?? '');
  // Absent on `initial` (a preferences.json saved before this field existed) means
  // "all enabled" — the implicit default this codebase already had.
  const [enabledPortals, setEnabledPortals] = useState<ScraperPortalId[]>(initial.enabledPortals ?? [...SCRAPER_PORTAL_IDS]);
  const [searchBudgetUsd, setSearchBudgetUsd] = useState(initial.searchBudgetUsd != null ? String(initial.searchBudgetUsd) : '');
  const [autoDismissBelowScore, setAutoDismissBelowScore] = useState(
    initial.autoDismissBelowScore != null ? String(initial.autoDismissBelowScore) : ''
  );
  const [franceTravailClientId, setFranceTravailClientId] = useState(initial.franceTravailClientId ?? '');
  // Always starts blank — GET never returns the real secret (see
  // SearchPreferences.franceTravailClientSecretConfigured), so there's nothing to
  // pre-fill. Left blank on save means "keep whatever's already stored" (see
  // handleSave below); the placeholder communicates whether one is already set.
  const [franceTravailClientSecret, setFranceTravailClientSecret] = useState('');
  // Tracked separately from `initial` (which never updates after mount — see the
  // "No `key` here" comment on PreferencesPage below) so the placeholder reflects a
  // secret just saved this session instead of staying stuck on "Not set" until reload.
  const [secretConfigured, setSecretConfigured] = useState(initial.franceTravailClientSecretConfigured ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const jobTitlesRef = useRef<TagInputHandle>(null);
  const locationsRef = useRef<TagInputHandle>(null);

  const toggleWorkMode = (mode: JobWorkMode, checked: boolean) => {
    setSaved(false);
    setWorkModes((prev) => (checked ? [...prev, mode] : prev.filter((m) => m !== mode)));
  };

  const togglePortal = (portal: ScraperPortalId, checked: boolean) => {
    setSaved(false);
    setEnabledPortals((prev) => (checked ? [...prev, portal] : prev.filter((p) => p !== portal)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // Flush any typed-but-not-yet-added draft text synchronously instead of relying on
    // the tag inputs' own onBlur: clicking Save while a tag input still has focus blurs
    // it as part of the same click, and the resulting re-render (new pill appearing)
    // can shift layout enough to make the click miss the Save button entirely. Reading
    // flush()'s return value also sidesteps needing to wait for a re-render before
    // this same function can see the committed value.
    const finalJobTitles = jobTitlesRef.current?.flush() ?? jobTitles;
    const finalLocations = locationsRef.current?.flush() ?? locations;
    try {
      const result = await onSave({
        jobTitles: finalJobTitles,
        locations: finalLocations,
        workModes,
        minGrossAnnualSalary: minSalary.trim() ? Number(minSalary) : undefined,
        cvId: cvId || undefined,
        enabledPortals,
        searchBudgetUsd: searchBudgetUsd.trim() ? Number(searchBudgetUsd) : undefined,
        autoDismissBelowScore: autoDismissBelowScore.trim() ? Number(autoDismissBelowScore) : undefined,
        franceTravailClientId: franceTravailClientId.trim() || undefined,
        // Omitted entirely (not sent as '') when untouched, so the server's "leave the
        // stored secret alone" branch applies — see routes.preferences.js.
        ...(franceTravailClientSecret.trim() ? { franceTravailClientSecret: franceTravailClientSecret.trim() } : {}),
      });
      setFranceTravailClientSecret(''); // never keep the just-typed secret in memory longer than the request
      setSecretConfigured(result.franceTravailClientSecretConfigured ?? false);
      setSaved(true);
    } catch {
      setError('Save error. Is the server running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="preferences-page">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-slate-800 mb-4">Search preferences</h1>
        {error && <div className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</div>}

        <div className="space-y-4">
          <TagInput
            ref={jobTitlesRef}
            label="Job titles"
            values={jobTitles}
            onChange={(v) => { setJobTitles(v); setSaved(false); }}
            placeholder="e.g. QA Engineer"
            testId="job-titles"
          />
          <TagInput
            ref={locationsRef}
            label="Locations"
            values={locations}
            onChange={(v) => { setLocations(v); setSaved(false); }}
            placeholder="e.g. Paris, Remote France"
            testId="locations"
          />

          <div>
            <label className="text-xs font-medium text-slate-500">Work modes</label>
            <div className="flex flex-wrap items-center gap-4 mt-1">
              {WORK_MODE_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={workModes.includes(value)}
                    onChange={(e) => toggleWorkMode(value, e.target.checked)}
                    data-testid={`work-mode-${value}-checkbox`}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Minimum gross annual salary (EUR)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={minSalary}
              onChange={(e) => { setMinSalary(e.target.value); setSaved(false); }}
              data-testid="min-salary-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">CV to use</label>
            <select
              value={cvId}
              onChange={(e) => { setCvId(e.target.value); setSaved(false); }}
              data-testid="preferences-cv-select"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">— None —</option>
              {cvs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Scraping sources</label>
            <div className="mt-1 space-y-2.5">
              {SCRAPER_PORTAL_IDS.map((portal) => (
                <div key={portal}>
                  <label className="flex items-center gap-1.5 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={enabledPortals.includes(portal)}
                      onChange={(e) => togglePortal(portal, e.target.checked)}
                      data-testid={`portal-${portal}-checkbox`}
                    />
                    {PORTAL_INFO[portal].label}
                  </label>
                  <p className="text-xs text-slate-400 mt-0.5 ml-5">{PORTAL_INFO[portal].description}</p>
                  {portal === 'france_travail' && (
                    <div className="ml-5 mt-2 space-y-2 max-w-sm">
                      <div>
                        <label className="text-xs font-medium text-slate-500">Client ID</label>
                        <input
                          type="text"
                          value={franceTravailClientId}
                          onChange={(e) => { setFranceTravailClientId(e.target.value); setSaved(false); }}
                          data-testid="france-travail-client-id-input"
                          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">Client secret</label>
                        <input
                          type="password"
                          value={franceTravailClientSecret}
                          onChange={(e) => { setFranceTravailClientSecret(e.target.value); setSaved(false); }}
                          placeholder={secretConfigured ? 'Saved — leave blank to keep' : 'Not set'}
                          data-testid="france-travail-client-secret-input"
                          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                      <p className="text-xs text-slate-400">
                        Free for personal use —{' '}
                        <a
                          href="https://francetravail.io"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          get an API key on francetravail.io
                        </a>
                        .
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Max AI web search budget (USD)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={searchBudgetUsd}
              onChange={(e) => { setSearchBudgetUsd(e.target.value); setSaved(false); }}
              placeholder="3"
              data-testid="search-budget-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <p className="text-xs text-slate-400 mt-0.5">Caps how much a single Claude web search run can spend before it stops itself.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Auto-dismiss below score</label>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={autoDismissBelowScore}
              onChange={(e) => { setAutoDismissBelowScore(e.target.value); setSaved(false); }}
              placeholder="45"
              data-testid="auto-dismiss-score-input"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <p className="text-xs text-slate-400 mt-0.5">Candidates scoring below this after AI qualification are auto-dismissed instead of listed as new.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="preferences-save-button"
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
        </div>
      </div>
    </div>
  );
};

const PreferencesPage: React.FC = () => {
  const { preferences, loading, error, fetchPreferences, savePreferences } = usePreferencesStore();
  const { cvs, fetchCvs } = useCvsStore();

  useEffect(() => {
    fetchPreferences();
    fetchCvs();
  }, [fetchPreferences, fetchCvs]);

  if (loading || !preferences) {
    return (
      <div className="h-full overflow-y-auto" data-testid="preferences-page">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {error && <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>}
          {loading && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}
        </div>
      </div>
    );
  }

  // No `key` here: the gate above (`if (loading || !preferences) return ...`) already
  // ensures PreferencesForm's first mount happens exactly once, only once real data
  // has arrived — so its useState initializers never miss async-loaded data. Keying
  // on `preferences.updatedAt` would force a remount on every successful save (since
  // saving changes updatedAt), wiping the in-progress "Saved" confirmation and any
  // unsaved edits before they could render.
  return <PreferencesForm initial={preferences} cvs={cvs} onSave={savePreferences} />;
};

export default PreferencesPage;
