import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell.jsx';
import { RequireAuth } from './components/shell/RequireAuth.jsx';
import { AppLockGate } from './components/shell/AppLockGate.jsx';
import { SignInScreen } from './screens/SignInScreen.jsx';
import { OverviewScreen } from './screens/OverviewScreen.jsx';
import { TendersScreen } from './screens/TendersScreen.jsx';
import { TenderDetailScreen } from './screens/TenderDetailScreen.jsx';
import { OrganizationTendersScreen } from './screens/OrganizationTendersScreen.jsx';
import { ProjectsScreen } from './screens/ProjectsScreen.jsx';
import { ProjectDetailScreen } from './screens/ProjectDetailScreen.jsx';
import { AlertsScreen } from './screens/AlertsScreen.jsx';
import { MoreScreen } from './screens/MoreScreen.jsx';

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInScreen /> },
  {
    path: '/',
    element: <RequireAuth><AppLockGate><AppShell /></AppLockGate></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewScreen /> },
      { path: 'tenders', element: <TendersScreen /> },
      { path: 'tenders/:id', element: <TenderDetailScreen /> },
      { path: 'tenders/org/:name', element: <OrganizationTendersScreen /> },
      { path: 'projects', element: <ProjectsScreen /> },
      { path: 'projects/:id', element: <ProjectDetailScreen /> },
      { path: 'alerts', element: <AlertsScreen /> },
      { path: 'more', element: <MoreScreen /> },
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/overview" replace /> },
]);
