import React, { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Briefcase, Building2, Layers, BarChart3, Settings, Radar, Activity } from 'lucide-react';
import { useScraperStore } from '../../store/scraperStore';

const NAV_ITEMS = [
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/job-search', icon: Radar, label: 'Discovery' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/cvs', icon: Layers, label: 'CV Library' },
  { to: '/insights', icon: BarChart3, label: 'Insights' },
  { to: '/observability', icon: Activity, label: 'Observability' },
  { to: '/preferences', icon: Settings, label: 'Preferences' },
];

const AppShell: React.FC = () => {
  // First store dependency this file has ever had — needed to badge "Discovery"
  // with a count of never-viewed offers regardless of which page is currently active.
  const { candidates, fetchCandidates } = useScraperStore();
  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);
  const unviewedCount = candidates.filter((c) => c.status === 'new' && !c.viewedAt).length;

  return (
    <div className="h-screen flex overflow-hidden bg-slate-100">
      <nav className="w-52 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-100">
          <span className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="text-base">📏</span>
            Sur-Mesure
          </span>
        </div>
        <div className="flex-1 py-3 flex flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
              {to === '/job-search' && unviewedCount > 0 && (
                <span
                  data-testid="nav-badge-job-search"
                  className="ml-auto bg-sky-500 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 min-w-[18px] text-center"
                >
                  {unviewedCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};

export default AppShell;
