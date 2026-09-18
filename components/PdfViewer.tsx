import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CVData } from '../types';
import { generateLatexWithPhoto } from '../services/latexService';
import { compileToPdf } from '../services/pdfService';
import { useTemplateSettingsStore } from '../store/templateSettingsStore';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface PdfViewerProps {
  data: CVData;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ data }) => {
  const { fontId } = useTemplateSettingsStore();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const lastCompiledJson = useRef<string>('');
  const lastCompiledFontId = useRef<string>('');
  const prevUrlRef = useRef<string | null>(null);

  const compile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsStale(false);
    const snapshot = JSON.stringify(data);
    try {
      const { latex, photoData } = generateLatexWithPhoto(data, fontId);
      const blob = await compileToPdf(latex, photoData);
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setPdfUrl(url);
      lastCompiledJson.current = snapshot;
      lastCompiledFontId.current = fontId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compilation error');
    } finally {
      setIsLoading(false);
    }
  }, [data, fontId]);

  // Auto-compile on first mount
  useEffect(() => {
    compile();
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect stale state when data or the selected font changes after first compile
  useEffect(() => {
    if (
      lastCompiledJson.current &&
      (JSON.stringify(data) !== lastCompiledJson.current || fontId !== lastCompiledFontId.current)
    ) {
      setIsStale(true);
    }
  }, [data, fontId]);

  return (
    <div className="w-full h-full flex flex-col gap-2">
      {isStale && !isLoading && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm shrink-0">
          <span>CV modified since last compilation.</span>
          <button
            onClick={compile}
            className="flex items-center gap-1.5 font-medium text-amber-700 hover:text-amber-900 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="text-sm">Compiling…</span>
        </div>
      )}

      {error && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-600">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <div className="text-center">
            <p className="font-medium text-red-600 mb-1">Compilation error</p>
            <p className="text-sm text-slate-500 max-w-sm">{error}</p>
            <p className="text-xs text-slate-400 mt-1">Make sure the LaTeX server is running on port 3001.</p>
          </div>
          <button
            onClick={compile}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}

      {pdfUrl && !isLoading && !error && (
        <iframe
          src={pdfUrl}
          className="flex-1 w-full rounded-lg shadow-lg border-0"
          title="PDF Preview"
        />
      )}
    </div>
  );
};

export default PdfViewer;
