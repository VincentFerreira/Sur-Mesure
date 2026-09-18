import React from 'react';
import { Link } from 'react-router-dom';
import { Company, Job } from '../../types';
import { STATUS_META } from '../jobs/statusMeta';
import { MEMBERSHIP_META, SIZE_META } from './companyMeta';

interface Props {
  companies: Company[];
  jobsByCompanyId: Map<string, Job[]>;
  onRowClick: (company: Company) => void;
}

const CompaniesTable: React.FC<Props> = ({ companies, jobsByCompanyId, onRowClick }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-200">
        <th className="py-2.5 pr-3">Company</th>
        <th className="py-2.5 pr-3">Location</th>
        <th className="py-2.5 pr-3">Size</th>
        <th className="py-2.5 pr-3">Tags</th>
        <th className="py-2.5 pr-3">Linked job(s)</th>
      </tr>
    </thead>
    <tbody>
      {companies.map((company) => {
        const jobs = jobsByCompanyId.get(company.id) ?? [];
        return (
          <tr
            key={company.id}
            data-testid={`company-row-${company.id}`}
            onClick={() => onRowClick(company)}
            className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors align-top"
          >
            <td className="py-3 pr-3">
              <p className="font-medium text-slate-800">{company.name}</p>
              {company.website && <p className="text-slate-400 text-xs truncate max-w-[180px]">{company.website}</p>}
            </td>
            <td className="py-3 pr-3 text-xs text-slate-500">{company.location || <span className="text-slate-300">—</span>}</td>
            <td className="py-3 pr-3 text-xs text-slate-500">{company.size ? SIZE_META[company.size].label : <span className="text-slate-300">—</span>}</td>
            <td className="py-3 pr-3">
              <div className="flex flex-wrap gap-1">
                {company.next40 && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MEMBERSHIP_META.next40.className}`}>
                    {MEMBERSHIP_META.next40.label}
                  </span>
                )}
                {company.frenchTech120 && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MEMBERSHIP_META.frenchTech120.className}`}>
                    {MEMBERSHIP_META.frenchTech120.label}
                  </span>
                )}
                {company.remoteFriendly && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MEMBERSHIP_META.remoteFriendly.className}`}>
                    {MEMBERSHIP_META.remoteFriendly.label}
                  </span>
                )}
                {!company.next40 && !company.frenchTech120 && !company.remoteFriendly && (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </div>
            </td>
            <td className="py-3 pr-3">
              {jobs.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No QA position yet</span>
              ) : (
                <ul className="space-y-1">
                  {jobs.map((job) => (
                    <li key={job.id} className="flex items-center gap-2">
                      <Link
                        to={`/jobs/${job.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {job.title}
                      </Link>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_META[job.status].className}`}>
                        {STATUS_META[job.status].label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export default CompaniesTable;
