import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, FileText, Trash2, Loader2 } from 'lucide-react';
import { useCvsStore } from '../store/cvsStore';

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}min ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-US');
}

const CvsPage: React.FC = () => {
  const { cvs, loading, error, fetchCvs, archiveCv } = useCvsStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    fetchCvs();
  }, [fetchCvs]);

  const handleArchive = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    archiveCv(id);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-800">CV Library</h1>
          <Link
            to="/cvs/new"
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New CV
          </Link>
        </div>

        {error && (
          <div className="text-amber-700 text-sm bg-amber-50 rounded-lg px-4 py-3 mb-4">{error}</div>
        )}

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && cvs.length === 0 && !error && (
          <div className="text-center py-16 text-slate-400">
            <p className="mb-3">No CVs yet.</p>
            <Link to="/cvs/new" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
              Create your first CV
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cvs.map((cv) => (
            <div
              key={cv.id}
              data-testid={`cv-card-${cv.id}`}
              className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 hover:border-indigo-200 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{cv.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {cv.language.toUpperCase()} · Updated {formatDate(cv.updatedAt)}
                  </p>
                </div>
              </div>

              {cv.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cv.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mt-auto pt-1">
                <Link
                  to={`/cvs/${cv.id}`}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleArchive(cv.id)}
                  onBlur={() => setConfirmId(null)}
                  className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                    confirmId === cv.id ? 'text-red-600 hover:text-red-800' : 'text-slate-300 hover:text-red-500'
                  }`}
                  title={confirmId === cv.id ? 'Click to confirm' : 'Archive'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmId === cv.id ? 'Confirm?' : ''}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CvsPage;
