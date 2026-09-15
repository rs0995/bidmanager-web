import React, { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { isSignedIn } from '../../lib/auth.js';
import { setAuthErrorHandler } from '../../lib/queryClient.js';
import { pullBookmarks } from '../../lib/sync.js';
import { resumePendingDownloadJobs } from '../../lib/documents.js';
import { resumePendingOrgRequests } from '../../lib/orgRequests.js';

// Auth gate that lives INSIDE the router tree (unlike a top-level
// conditional render in App.jsx, which would render SignInScreen outside
// any <Router> and crash useNavigate() there). Also registers the global
// AuthError handler here so a 401/403 on any /client/* call redirects to
// /signin via the router instead of needing state lifted to App.jsx.
export function RequireAuth({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    setAuthErrorHandler(() => navigate('/signin', { replace: true }));
  }, [navigate]);

  // On a reload with a saved session, nothing else pulls the /client/sync
  // blob (only SignInScreen does) or resumes in-flight download jobs — do
  // both here so schedulePush never starts from an empty blob and a
  // mid-scrape reload keeps polling.
  useEffect(() => {
    if (!isSignedIn()) return;
    pullBookmarks().catch(() => {});
    resumePendingDownloadJobs();
    resumePendingOrgRequests();
  }, []);

  if (!isSignedIn()) return <Navigate to="/signin" replace />;
  return children;
}
