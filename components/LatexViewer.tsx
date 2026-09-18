import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CVData } from '../types';
import { generateLatex, generateLatexWithPhoto, getTemplate } from '../services/latexService';
import { saveLatexTemplate, resetLatexTemplate, loadLatexTemplate } from '../services/templateStorageService';
import { compileToPdf, PhotoData } from '../services/pdfService';
import { useTemplateSettingsStore } from '../store/templateSettingsStore';
import FontSelector from './FontSelector';
import { Copy, Check, RefreshCw, RotateCcw, Loader2, AlertCircle, Save, FileCode2 } from 'lucide-react';

interface LatexViewerProps {
  data: CVData;
}

type ViewMode = 'generated' | 'template';

const DEBOUNCE_MS = 1500;

const LatexViewer: React.FC<LatexViewerProps> = ({ data }) => {
  const { fontId, error: fontError, setFont } = useTemplateSettingsStore();
  const [viewMode, setViewMode] = useState<ViewMode>('generated');
  const [{ latex: initLatex, photoData: initPhoto }] = useState(() => generateLatexWithPhoto(data, fontId));
  const [latexCode, setLatexCode] = useState(initLatex);
  const [photoData, setPhotoData] = useState<PhotoData | null>(initPhoto ?? null);
  const [isModified, setIsModified] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  // Template view state
  const [templateCode, setTemplateCode] = useState(() => getTemplate());
  const [hasCustomTemplate, setHasCustomTemplate] = useState(() => loadLatexTemplate() !== null);
  const [templateSaved, setTemplateSaved] = useState(false);

  const autoLatexRef = useRef(initLatex);
  const prevUrlRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const compile = useCallback(async (code: string, pd: PhotoData | null) => {
    setIsCompiling(true);
    setCompileError(null);
    try {
      const blob = await compileToPdf(code, pd);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setPdfUrl(url);
    } catch (err) {
      setCompileError(err instanceof Error ? err.message : 'Compilation error');
    } finally {
      setIsCompiling(false);
    }
  }, []);

  // Compile on mount immediately, cleanup URL on unmount
  useEffect(() => {
    compile(initLatex, initPhoto ?? null);
    return () => { if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync from form data or font changes when not manually modified
  useEffect(() => {
    const { latex, photoData: pd } = generateLatexWithPhoto(data, fontId);
    autoLatexRef.current = latex;
    setPhotoData(pd ?? null);
    if (!isModified) setLatexCode(latex);
  }, [data, fontId, isModified]);

  // Debounced compile on every code/photo change (skip first render — handled above)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => compile(latexCode, photoData), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [latexCode, photoData, compile]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLatexCode(val);
    setIsModified(val !== autoLatexRef.current);
  };

  const handleReset = () => {
    setLatexCode(autoLatexRef.current);
    setIsModified(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(latexCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveTemplate = () => {
    saveLatexTemplate(templateCode);
    setHasCustomTemplate(true);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2000);
  };

  const handleResetTemplate = () => {
    resetLatexTemplate();
    setHasCustomTemplate(false);
    setTemplateCode(getTemplate());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = latexCode.substring(0, start) + '  ' + latexCode.substring(end);
    setLatexCode(next);
    setIsModified(next !== autoLatexRef.current);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumRef.current) lineNumRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const lineCount = latexCode.split('\n').length;

  return (
    <div className="w-full h-full flex flex-col bg-slate-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* View mode toggle */}
          <div className="flex bg-slate-700 rounded-md p-0.5 gap-0.5 shrink-0">
            <button
              onClick={() => setViewMode('generated')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${viewMode === 'generated' ? 'bg-slate-900 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              LaTeX
            </button>
            <button
              onClick={() => setViewMode('template')}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors ${viewMode === 'template' ? 'bg-slate-900 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <FileCode2 className="w-3 h-3" />
              Template
              {hasCustomTemplate && <span className="bg-indigo-500 text-white text-[9px] px-1 py-px rounded-full leading-none">perso</span>}
            </button>
          </div>

          {viewMode === 'generated' && (
            <>
              <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full shrink-0 ${isModified ? 'text-amber-300 bg-amber-900/30' : 'text-slate-400 bg-slate-700/50'}`}>
                {isModified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                {isModified ? 'Modified' : 'Auto-generated'}
              </span>
              {isModified && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-amber-300 hover:text-amber-100 bg-amber-900/20 border border-amber-700/40 rounded transition-colors shrink-0"
                  title="Reset to auto-generated LaTeX"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'generated' ? (
            <>
              {isCompiling && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Compiling…
                </span>
              )}
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => compile(latexCode, photoData)}
                disabled={isCompiling}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCompiling ? 'animate-spin' : ''}`} />
                Compile
              </button>
            </>
          ) : (
            <>
              {isCompiling && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Compiling…
                </span>
              )}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-slate-400">Font:</span>
                <FontSelector value={fontId} onChange={setFont} />
              </div>
              {fontError && <span className="text-xs text-red-400 shrink-0">{fontError}</span>}
              {hasCustomTemplate && (
                <button
                  onClick={handleResetTemplate}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                  title="Reset to the default template"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
              <button
                onClick={handleSaveTemplate}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${templateSaved ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {templateSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {templateSaved ? 'Saved!' : 'Save'}
              </button>
              <button
                onClick={() => compile(generateLatex(data, templateCode, fontId), photoData)}
                disabled={isCompiling}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCompiling ? 'animate-spin' : ''}`} />
                Compiler
              </button>
            </>
          )}
        </div>
      </div>

      {/* Split pane — left panel switches by mode, PDF always visible on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 flex overflow-hidden border-r border-slate-700 min-w-0">
          {viewMode === 'generated' ? (
            <>
              <div
                ref={lineNumRef}
                aria-hidden="true"
                className="w-10 bg-slate-900 text-slate-600 font-mono text-xs text-right pr-2 py-4 overflow-hidden select-none shrink-0"
                style={{ lineHeight: '1.5rem' }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={latexCode}
                onChange={handleCodeChange}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                spellCheck={false}
                className="flex-1 bg-slate-900 text-slate-300 font-mono text-xs py-4 pl-2 pr-4 resize-none focus:outline-none"
                style={{ lineHeight: '1.5rem' }}
              />
            </>
          ) : (
            <textarea
              value={templateCode}
              onChange={e => setTemplateCode(e.target.value)}
              spellCheck={false}
              className="flex-1 bg-slate-900 text-slate-300 font-mono text-xs py-4 px-4 resize-none focus:outline-none"
              style={{ lineHeight: '1.5rem' }}
            />
          )}
        </div>

        {/* PDF preview — always visible */}
        <div className="flex-1 flex flex-col bg-slate-700 min-w-0 relative">
          {compileError && (
            <div className="m-2 p-3 bg-red-950/70 border border-red-700 rounded-lg shrink-0">
              <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold mb-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                LaTeX Error
              </div>
              <pre className="text-red-300 text-xs whitespace-pre-wrap font-mono max-h-32 overflow-auto leading-relaxed">{compileError}</pre>
            </div>
          )}
          {pdfUrl ? (
            <div className="flex-1 relative">
              {isCompiling && (
                <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center z-10">
                  <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-xl shadow-lg text-sm text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    Recompiling…
                  </div>
                </div>
              )}
              <iframe src={pdfUrl} className="w-full h-full border-0" title="PDF Preview" />
            </div>
          ) : isCompiling ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <span className="text-sm">Compiling PDF…</span>
              <span className="text-xs text-slate-500">This may take a few seconds</span>
            </div>
          ) : !compileError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
              <span className="text-sm">Click <strong className="text-slate-400">Compile</strong> to generate the PDF</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-slate-800 border-t border-slate-700 px-4 py-1.5 flex items-center justify-between shrink-0">
        {viewMode === 'generated' ? (
          <>
            <span className="text-xs text-slate-500">
              Edits auto-compile after {DEBOUNCE_MS / 1000}s · <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-400">Tab</kbd> inserts 2 spaces
            </span>
            <span className="text-xs text-slate-600">
              Photo file must be named <code className="bg-slate-700 px-1 rounded text-slate-400">photo.jpg</code>
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-500">
            Mustache syntax · <code className="bg-slate-700 px-1 rounded text-slate-400">[[variable]]</code> —
            loops <code className="bg-slate-700 px-1 rounded text-slate-400">[[# items ]]..[[/ items ]]</code> —
            conditionals <code className="bg-slate-700 px-1 rounded text-slate-400">[[^ field ]]</code>
          </span>
        )}
      </div>
    </div>
  );
};

export default LatexViewer;
