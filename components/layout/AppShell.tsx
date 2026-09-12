import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Briefcase, Building2, Layers, BarChart3 } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/jobs', icon: Briefcase, label: 'Postes' },
  { to: '/companies', icon: Building2, label: 'Entreprises' },
  { to: '/cvs', icon: Layers, label: 'CVthèque' },
  { to: '/insights', icon: BarChart3, label: 'Analyse' },
];

const AppShell: React.FC = () => (
  <div className="h-screen flex overflow-hidden bg-slate-100">
    <nav className="w-52 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-4 py-4 border-b border-slate-100">
        <span className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded-md text-sm">CV</span>
          YARB
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
          </NavLink>
        ))}
      </div>
    </nav>
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <Outlet />
    </div>
  </div>
);

export default AppShell;
