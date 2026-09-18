import React, { useMemo, useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { useCompaniesStore } from '../../store/companiesStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const normalize = (name: string) => name.trim().toLowerCase();

const BulkAddCompaniesDialog: React.FC<Props> = ({ open, onClose }) => {
  const { companies, bulkAddCompanies } = useCompaniesStore();
  const [rawText, setRawText] = useState('');
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setRawText('');
    setStep('paste');
    setRemoved(new Set());
    setError(null);
    onClose();
  };

  const { toCreate, alreadyExists } = useMemo(() => {
    const existingNames = new Set(companies.map((c) => normalize(c.name)));
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const create: string[] = [];
    const exists: string[] = [];
    for (const line of lines) {
      const key = normalize(line);
      if (seen.has(key)) continue;
      seen.add(key);
      if (existingNames.has(key)) exists.push(line);
      else create.push(line);
    }
    return { toCreate: create, alreadyExists: exists };
  }, [rawText, companies]);

  if (!open) return null;

  const finalNames = toCreate.filter((name) => !removed.has(normalize(name)));

  const handleReview = () => {
    if (toCreate.length === 0 && alreadyExists.length === 0) return;
    setRemoved(new Set());
    setStep('review');
  };

  const handleConfirm = async () => {
    if (finalNames.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await bulkAddCompanies(finalNames);
      handleClose();
    } catch {
      setError('Unable to create companies. Is the server running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div data-testid="bulk-companies-dialog" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">Bulk add companies</h2>
          <button type="button" onClick={handleClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && <div className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          {step === 'paste' && (
            <>
              <p className="text-sm text-slate-500">
                Paste one company name per line. You'll review the list before anything is created —
                add details (size, location, NEXT40, remote…) for each one afterward.
              </p>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={'Doctolib\nQonto\nAlan'}
                rows={10}
                data-testid="bulk-companies-textarea"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </>
          )}

          {step === 'review' && (
            <>
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{finalNames.length} new companies</p>
                <ul className="space-y-1.5">
                  {toCreate.map((name) => {
                    const isRemoved = removed.has(normalize(name));
                    return (
                      <li
                        key={name}
                        className={`flex items-center justify-between text-sm rounded-lg px-3 py-1.5 ${
                          isRemoved ? 'bg-slate-50 text-slate-300 line-through' : 'bg-slate-50 text-slate-700'
                        }`}
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() =>
                            setRemoved((prev) => {
                              const next = new Set(prev);
                              const key = normalize(name);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                          className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
                        >
                          {isRemoved ? 'Undo' : <X className="w-3.5 h-3.5" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {alreadyExists.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1.5">
                    {alreadyExists.length} already exist — will be skipped
                  </p>
                  <ul className="space-y-1">
                    {alreadyExists.map((name) => (
                      <li key={name} className="text-xs text-slate-400 px-3 py-1 bg-slate-50 rounded-lg">
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between gap-2">
          {step === 'review' ? (
            <button type="button" onClick={() => setStep('paste')} className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
              Back
            </button>
          ) : <div />}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={handleClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            {step === 'paste' ? (
              <button
                type="button"
                onClick={handleReview}
                disabled={!rawText.trim()}
                data-testid="bulk-companies-review-button"
                className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Review
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={saving || finalNames.length === 0}
                data-testid="bulk-companies-confirm-button"
                className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add {finalNames.length} companies
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkAddCompaniesDialog;
