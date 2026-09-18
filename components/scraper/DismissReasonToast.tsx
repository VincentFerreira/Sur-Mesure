import React, { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onSave: (reason: string) => void;
  onClose: () => void;
}

// Non-blocking follow-up shown right after a dismiss (see store/scraperStore.ts's
// lastDismissed) — the dismiss itself already happened, this only offers to attach an
// optional reason afterwards. Feeds server/scraperCandidatesStore.js's
// listRejectionReasons, which server/scrapers/claudeCli.js's qualifyAll uses to score
// similar future postings lower instead of resurfacing them unfiltered.
const DismissReasonToast: React.FC<Props> = ({ title, onSave, onClose }) => {
  const [reason, setReason] = useState('');

  // Empty input on submit is just "skip" — a blank reason is never worth persisting,
  // and this keeps Enter/OK a single always-safe action regardless of what was typed.
  const submit = () => {
    const trimmed = reason.trim();
    if (trimmed) onSave(trimmed);
    else onClose();
  };

  return (
    <div
      className="fixed bottom-4 right-4 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 w-80 z-50"
      data-testid="dismiss-reason-toast"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">{title}</span> écartée.
        </p>
        <button
          onClick={onClose}
          data-testid="dismiss-reason-toast-close"
          aria-label="Fermer"
          className="text-slate-300 hover:text-slate-500 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Pourquoi ? (optionnel)"
          data-testid="dismiss-reason-input"
          className="flex-1 text-xs border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        <button
          onClick={submit}
          data-testid="dismiss-reason-save"
          className="text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-md px-2.5 py-1.5 hover:bg-indigo-50"
        >
          OK
        </button>
      </div>
    </div>
  );
};

export default DismissReasonToast;
