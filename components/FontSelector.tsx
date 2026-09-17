import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { CV_FONTS, getFontById } from '../lib/fonts';

interface Props {
  value?: string;
  onChange: (fontId: string) => void;
}

const SANS = CV_FONTS.filter(f => f.category === 'sans-serif');
const SERIF = CV_FONTS.filter(f => f.category === 'serif');

const FontSelector: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getFontById(value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (id: string) => { onChange(id); setOpen(false); };

  const renderOption = (font: typeof CV_FONTS[0]) => (
    <button
      key={font.id}
      onClick={() => select(font.id)}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-700 transition-colors rounded-md"
    >
      <span style={{ fontFamily: font.cssFontFamily }} className="text-sm text-slate-200">
        {font.name}
      </span>
      {font.id === current.id && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
        title="Choisir la police"
      >
        <span style={{ fontFamily: current.cssFontFamily }} className="text-xs">
          {current.name}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-lg py-2 w-52 z-20">
          <p className="px-3 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Sans-serif</p>
          <div className="px-1">{SANS.map(renderOption)}</div>
          <div className="my-1.5 border-t border-slate-700" />
          <p className="px-3 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Serif</p>
          <div className="px-1">{SERIF.map(renderOption)}</div>
        </div>
      )}
    </div>
  );
};

export default FontSelector;
