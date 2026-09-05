import React, { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { isSignedIn } from '../../lib/auth.js';
import { setAuthErrorHandler } from '../../lib/queryClient.js';

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

  if (!isSignedIn()) return <Navigate to="/signin" replace />;
  return children;
}
