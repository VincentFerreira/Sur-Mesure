import { forwardRef, useImperativeHandle, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Props {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  testId: string;
}

export interface TagInputHandle {
  // Commits any pending (typed but not yet added) draft text and returns the
  // resulting full list synchronously. A caller that needs the up-to-date list
  // *immediately* (e.g. Save, which reads its own state in the same tick and can't
  // wait for the onChange callback to flow back through a re-render) must use this
  // return value rather than the `values` prop right after calling flush().
  flush: () => string[];
}

const TagInput = forwardRef<TagInputHandle, Props>(({ label, values, onChange, placeholder, testId }, ref) => {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  useImperativeHandle(ref, () => ({
    flush: () => {
      const v = draft.trim();
      setDraft('');
      if (!v || values.includes(v)) return values;
      const next = [...values, v];
      onChange(next);
      return next;
    },
  }));

  return (
    <div>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <div className="mt-1 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          // Best-effort immediate feedback when tabbing/clicking away — not relied on
          // for correctness at Save time, since a click that lands on the Save button
          // in the same gesture as this blur can shift layout mid-click and miss it.
          // Save always calls flush() explicitly instead (see TagInputHandle above).
          onBlur={commit}
          placeholder={placeholder}
          data-testid={`${testId}-input`}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          type="button"
          // Without this, clicking the button blurs the input first (mousedown fires
          // before click), so both the input's onBlur and this onClick would call
          // commit() for the same draft — double-adding it. preventDefault keeps focus
          // on the input, so only this handler runs.
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          data-testid={`${testId}-add-button`}
          className="shrink-0 flex items-center gap-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 hover:border-indigo-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2" data-testid={`${testId}-list`}>
          {values.map((v) => (
            <span key={v} className="flex items-center gap-1 text-xs bg-slate-50 text-slate-700 rounded-full px-2.5 py-1">
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

export default TagInput;
