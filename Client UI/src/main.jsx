import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import App from './App.jsx';
import { api } from './lib/api.js';
import './globals.css';

// A rejected token (expired/revoked/suspended) surfaces from any /client/*
// call as an AuthError. Handling it here, once, clears local auth state and
// invalidates the settings query so App re-renders into the sign-in screen —
// no individual query/mutation needs its own 401/403 handling.
function handleAuthError(error) {
  if (error?.name !== 'AuthError') return;
  api.signOut().finally(() => queryClient.invalidateQueries({ queryKey: ['settings'] }));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
