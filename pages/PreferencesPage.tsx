import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePreferencesStore } from '../store/preferencesStore';
import { useCvsStore } from '../store/cvsStore';
import { CvMeta, JobWorkMode, SearchPreferences } from '../types';
import { SavePreferencesInput } from '../services/preferencesService';
import TagInput, { TagInputHandle } from '../components/preferences/TagInput';

const WORK_MODE_OPTIONS: { value: JobWorkMode; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const jobTitlesRef = useRef<TagInputHandle>(null);
  const locationsRef = useRef<TagInputHandle>(null);

  const toggleWorkMode = (mode: JobWorkMode, checked: boolean) => {
    setSaved(false);
    setWorkModes((prev) => (checked ? [...prev, mode] : prev.filter((m) => m !== mode)));
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
      await onSave({
        jobTitles: finalJobTitles,
        locations: finalLocations,
        workModes,
        minGrossAnnualSalary: minSalary.trim() ? Number(minSalary) : undefined,
        cvId: cvId || undefined,
      });
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
