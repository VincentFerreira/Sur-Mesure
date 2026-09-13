import React from 'react';
import { ScrapedJob } from '../../types';
import { SCRAPED_JOB_STATUS_META, SCRAPED_JOB_FIT_META, portalLabel } from './scrapedJobMeta';

interface Props {
  candidates: ScrapedJob[];
  onImport: (candidate: ScrapedJob) => void;
  onDismiss: (candidate: ScrapedJob) => void;
}

const ScrapedJobsTable: React.FC<Props> = ({ candidates, onImport, onDismiss }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-200">
        <th className="py-2.5 pr-3">Company</th>
        <th className="py-2.5 pr-3">Title</th>
        <th className="py-2.5 pr-3">Location</th>
        <th className="py-2.5 pr-3">Posted</th>
        <th className="py-2.5 pr-3">Portal</th>
        <th className="py-2.5 pr-3">Fit</th>
        <th className="py-2.5 pr-3">Status</th>
        <th className="py-2.5 pr-3 pl-4">Actions</th>
      </tr>
    </thead>
    <tbody>
      {candidates.map((candidate) => (
        <tr
          key={candidate.id}
          data-testid={`scraped-job-row-${candidate.id}`}
          className="border-b border-slate-100 last:border-0 align-top"
        >
          <td className="py-3 pr-3 font-medium text-slate-800">{candidate.company}</td>
          <td className="py-3 pr-3">
            <a href={candidate.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-800">
              {candidate.title}
            </a>
          </td>
          <td className="py-3 pr-3 text-xs text-slate-500">{candidate.location || <span className="text-slate-300">—</span>}</td>
          <td className="py-3 pr-3 text-xs text-slate-500">{candidate.postedDate || <span className="text-slate-300">—</span>}</td>
          <td className="py-3 pr-3 text-xs text-slate-500">{portalLabel(candidate.portal)}</td>
          <td className="py-3 pr-3">
            {candidate.fit ? (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SCRAPED_JOB_FIT_META[candidate.fit].className}`}>
                {SCRAPED_JOB_FIT_META[candidate.fit].label}
              </span>
            ) : (
              <span className="text-xs text-slate-300">—</span>
            )}
          </td>
          <td className="py-3 pr-3">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SCRAPED_JOB_STATUS_META[candidate.status].className}`}>
              {SCRAPED_JOB_STATUS_META[candidate.status].label}
            </span>
          </td>
          <td className="py-3 pr-3 pl-4">
            {candidate.status === 'new' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onImport(candidate)}
                  data-testid={`import-scraped-job-${candidate.id}`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Import
                </button>
                <button
                  onClick={() => onDismiss(candidate)}
                  data-testid={`dismiss-scraped-job-${candidate.id}`}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Dismiss
                </button>
              </div>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default ScrapedJobsTable;
