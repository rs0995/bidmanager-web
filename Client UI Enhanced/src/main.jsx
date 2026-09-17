import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import App from './App.jsx';
import IosThemePreview from './IosThemePreview.jsx';
import { api } from './lib/api.js';
import './globals.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

// Standalone, non-wired theme preview. Open  /?preview=ios  to see the Client
// UI re-skinned with the Mobile App's light "iOS" theme (button placement and
// features unchanged). The real app renders normally without the flag.
if (new URLSearchParams(window.location.search).get('preview') === 'ios') {
  root.render(
    <React.StrictMode>
      <IosThemePreview />
    </React.StrictMode>,
  );
} else {
  // A rejected token (expired/revoked/suspended) surfaces from any /client/*
  // call as an AuthError. Handling it here, once, clears local auth state and
  // invalidates the settings query so App re-renders into the sign-in screen —
  // no individual query/mutation needs its own 401/403 handling.
  const handleAuthError = (error) => {
    if (error?.name !== 'AuthError') return;
    api.signOut().finally(() => queryClient.invalidateQueries({ queryKey: ['settings'] }));
  };

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({ onError: handleAuthError }),
  });

  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
