import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { INITIAL_CV_DATA } from '../constants';
import { CVData, ATSAnalysisResult } from '../types';
import { LANGUAGES } from '../lib/i18n';
import Editor from '../components/Editor';
import Preview from '../components/Preview';
import LatexViewer from '../components/LatexViewer';
import PdfViewer from '../components/PdfViewer';
import ATSChecker from '../components/ATSChecker';
import AnalysisOverlay, { AnalysisStep } from '../components/AnalysisOverlay';
import ImportPdfModal from '../components/ImportPdfModal';
import CVManager from '../components/CVManager';
import { generateLatex, generateLatexWithPhoto } from '../services/latexService';
import { parseResumeFromPdf, AIProvider } from '../services/aiService';
import { compileToPdf, downloadBlob } from '../services/pdfService';
import { exportAsHtml } from '../services/htmlService';
import { autoSaveToLocalStorage, restoreFromLocalStorage, loadCV } from '../services/cvStorageService';
import { useTemplateSettingsStore } from '../store/templateSettingsStore';
import {
  UploadCloud, Loader2, Layers, Download,
  ChevronDown, Eye, Code2, FileText, Globe,
} from 'lucide-react';

type PreviewMode = 'html' | 'latex' | 'pdf';

const PREVIEW_MODES: { mode: PreviewMode; icon: React.ElementType; label: string }[] = [
  { mode: 'html', icon: Eye, label: 'HTML' },
  { mode: 'latex', icon: Code2, label: 'LaTeX' },
  { mode: 'pdf', icon: FileText, label: 'PDF' },
];

interface EditorLocationState {
  activeTab?: 'editor' | 'ats';
  atsJobDescription?: string;
  atsResult?: ATSAnalysisResult;
}

const EditorPage: React.FC = () => {
  const { cvId: routeCvId } = useParams<{ cvId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const cvId = routeCvId ?? 'new';
  const locationState = location.state as EditorLocationState | null;

  const [cvData, setCvData] = useState<CVData>(INITIAL_CV_DATA);
  const [currentCVId, setCurrentCVId] = useState<string | null>(null);
  const [currentCVName, setCurrentCVName] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [showCVManager, setShowCVManager] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'ats'>(locationState?.activeTab ?? 'editor');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('html');
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep>('idle');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const { fontId, fetchTemplateSettings } = useTemplateSettingsStore();

  // Tracks which cvId's data is already reflected in state, so the effect below
  // only fetches on genuine navigation (typed URL, browser back/forward) — not
  // after CVManager/import already applied the data and navigated as a side effect.
  const appliedCvIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (appliedCvIdRef.current === cvId) return;
    appliedCvIdRef.current = cvId;
    setNotFound(false);

    if (cvId === 'new') {
      const saved = restoreFromLocalStorage();
      setCvData(saved ?? INITIAL_CV_DATA);
      setCurrentCVId(null);
      setCurrentCVName('');
      return;
    }

    loadCV(cvId)
      .then((record) => {
        setCvData(record.data);
        setCurrentCVId(record.id);
        setCurrentCVName(record.label);
      })
      .catch(() => {
        setNotFound(true);
      });
  }, [cvId]);

  // Auto-save to localStorage on every change (debounced 1s)
  useEffect(() => {
    const timer = setTimeout(() => autoSaveToLocalStorage(cvData), 1000);
    return () => clearTimeout(timer);
  }, [cvData]);

  useEffect(() => {
    fetchTemplateSettings();
  }, [fetchTemplateSettings]);

  useEffect(() => {
    document.documentElement.lang = cvData.currentLanguage;
  }, [cvData.currentLanguage]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!showExportDropdown) return;
    const handler = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportDropdown]);

  const isOverlayVisible = analysisStep !== 'idle';

  // CV Manager callbacks
  const handleCVLoad = (data: CVData, id: string, name: string) => {
    const targetId = id || 'new';
    appliedCvIdRef.current = targetId;
    setCvData(data);
    setCurrentCVId(id || null);
    setCurrentCVName(name);
    navigate(`/cvs/${targetId}`);
  };

  const handleCVSaved = (id: string, name: string) => {
    setCurrentCVId(id || null);
    setCurrentCVName(name);
    if (id) {
      appliedCvIdRef.current = id;
      if (cvId !== id) navigate(`/cvs/${id}`, { replace: true });
    }
  };

  const handleNewCV = () => {
    appliedCvIdRef.current = 'new';
    setCvData(INITIAL_CV_DATA);
    setCurrentCVId(null);
    setCurrentCVName('');
    if (cvId !== 'new') navigate('/cvs/new');
  };

  // JSON export
  const handleExportJson = () => {
    setShowExportDropdown(false);
    const dataStr = JSON.stringify(cvData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const fileName = `cv_${cvData.personalInfo.firstName || 'export'}_${cvData.personalInfo.lastName || ''}_${new Date().toISOString().split('T')[0]}.json`;
    downloadBlob(blob, fileName.replace(/\s+/g, '_'));
  };

  const handleExportHtml = () => {
    setShowExportDropdown(false);
    // Ensure we're on the HTML view so the DOM element exists
    if (previewMode !== 'html') setPreviewMode('html');
    // Delay slightly to allow React to render the Preview if not already shown
    setTimeout(() => exportAsHtml(cvData), 50);
  };

  const handleExportLatex = () => {
    setShowExportDropdown(false);
    const code = generateLatex(cvData, undefined, fontId);
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const fileName = `cv_${cvData.personalInfo.firstName || 'export'}_${cvData.personalInfo.lastName || ''}.tex`.replace(/\s+/g, '_');
    downloadBlob(blob, fileName);
  };

  const handleExportPdf = async () => {
    setShowExportDropdown(false);
    setIsGeneratingPdf(true);
    try {
      const { latex, photoData } = generateLatexWithPhoto(cvData, fontId);
      const pdfBlob = await compileToPdf(latex, photoData);
      const fileName = `cv_${cvData.personalInfo.firstName || 'export'}_${cvData.personalInfo.lastName || ''}.pdf`;
      downloadBlob(pdfBlob, fileName.replace(/\s+/g, '_'));
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Make sure the LaTeX server is running on port 3001.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleImportClick = () => {
    setShowImportModal(true);
  };

  const handleImportConfirm = () => {
    setShowImportModal(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) fileInputRef.current.value = '';

    if (file.type !== 'application/pdf') {
      setAnalysisError('The selected file is not a PDF.');
      setAnalysisStep('error');
      return;
    }

    setAnalysisError(null);
    setAnalysisStep('reading');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      if (!base64) return;
      try {
        const extractedData = await parseResumeFromPdf(base64, aiProvider, (step) => {
          setAnalysisStep(step);
        });
        setCvData(prev => ({
          ...extractedData,
          personalInfo: { ...extractedData.personalInfo, photo: prev.personalInfo.photo }
        }));
        setAnalysisStep('done');
      } catch (error) {
        console.error('Error parsing PDF:', error);
        setAnalysisError(error instanceof Error ? error.message : String(error));
        setAnalysisStep('error');
      }
    };
    reader.onerror = () => {
      setAnalysisError('Unable to read the file. Make sure it is not corrupted.');
      setAnalysisStep('error');
    };
    reader.readAsDataURL(file);
  };

  const handleDismissAnalysis = () => {
    setAnalysisStep('idle');
    setAnalysisError(null);
  };

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
        <p>This CV could not be found.</p>
        <button
          onClick={() => navigate('/cvs')}
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
        >
          Back to CVthèque
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <AnalysisOverlay
        step={analysisStep}
        provider={aiProvider}
        error={analysisError}
        timeoutSeconds={90}
        onDismiss={handleDismissAnalysis}
      />
      <ImportPdfModal
        open={showImportModal}
        aiProvider={aiProvider}
        onAiProviderChange={setAiProvider}
        onConfirm={handleImportConfirm}
        onClose={() => setShowImportModal(false)}
      />
      <CVManager
        open={showCVManager}
        onClose={() => setShowCVManager(false)}
        currentCVId={currentCVId}
        currentCVName={currentCVName}
        cvData={cvData}
        onLoad={handleCVLoad}
        onSaved={handleCVSaved}
        onNewCV={handleNewCV}
      />

      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center z-10 shrink-0 gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded-md text-sm">CV</span>
            Builder
          </h1>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setCvData(prev => ({ ...prev, currentLanguage: code }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${cvData.currentLanguage === code ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input type="file" accept=".pdf" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

          <button
            onClick={() => setShowCVManager(true)}
            data-testid="cv-manager-button"
            className="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-200 px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            disabled={isOverlayVisible}
            title={currentCVName ? `Current CV: ${currentCVName}` : 'Manage my CVs'}
          >
            <Layers className="w-4 h-4" />
            {currentCVName ? currentCVName : 'My CVs'}
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-200 px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            disabled={isOverlayVisible}
            title="Import an existing CV via AI"
          >
            <UploadCloud className="w-4 h-4" />
            Import PDF
          </button>

          {/* Export dropdown */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              onClick={() => setShowExportDropdown(v => !v)}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              disabled={isOverlayVisible || isGeneratingPdf}
            >
              {isGeneratingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {isGeneratingPdf ? 'Generating…' : 'Export'}
              {!isGeneratingPdf && <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
            </button>

            {showExportDropdown && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px] z-20">
                <button
                  onClick={handleExportHtml}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Globe className="w-4 h-4 text-slate-400" />
                  HTML
                </button>
                <button
                  onClick={handleExportLatex}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Code2 className="w-4 h-4 text-slate-400" />
                  LaTeX (.tex)
                </button>
                <button
                  onClick={handleExportPdf}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileText className="w-4 h-4 text-slate-400" />
                  PDF
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={handleExportJson}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Download className="w-4 h-4 text-slate-400" />
                  JSON (backup)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Editor Panel (Left) */}
        <div className="w-full md:w-1/3 lg:w-1/4 min-w-[350px] border-r border-slate-200 bg-white h-full overflow-hidden flex flex-col">
          <div className="flex border-b border-slate-200 shrink-0">
            <button
              onClick={() => setActiveTab('editor')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'editor'
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              Editor
            </button>
            <button
              onClick={() => setActiveTab('ats')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'ats'
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              ATS Checker
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab === 'editor'
              ? <Editor data={cvData} onChange={setCvData} />
              : (
                <ATSChecker
                  cvData={cvData}
                  aiProvider={aiProvider}
                  onAiProviderChange={setAiProvider}
                  initialJobDescription={locationState?.atsJobDescription}
                  initialResult={locationState?.atsResult}
                />
              )
            }
          </div>
        </div>

        {/* Preview Panel (Right) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* View Switcher */}
          <div className="bg-white border-b border-slate-200 px-4 py-2 flex justify-center items-center gap-1 shrink-0">
            {PREVIEW_MODES.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setPreviewMode(mode)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  previewMode === mode
                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* View Content */}
          <div className={`flex-1 ${
            previewMode === 'latex'
              ? 'overflow-hidden'
              : previewMode === 'pdf'
              ? 'overflow-auto p-4 bg-slate-100'
              : 'overflow-auto p-8 bg-slate-100 flex justify-center items-start'
          }`}>
            {previewMode === 'html' && <Preview data={cvData} />}
            {previewMode === 'latex' && <LatexViewer data={cvData} />}
            {previewMode === 'pdf' && <PdfViewer data={cvData} />}
          </div>
        </div>
      </main>
    </div>
  );
};

export default EditorPage;
