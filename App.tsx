import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import CompaniesPage from './pages/CompaniesPage';
import CvsPage from './pages/CvsPage';
import EditorPage from './pages/EditorPage';
import InsightsPage from './pages/InsightsPage';
import PreferencesPage from './pages/PreferencesPage';

const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/jobs" replace />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/cvs" element={<CvsPage />} />
        <Route path="/cvs/:cvId" element={<EditorPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
