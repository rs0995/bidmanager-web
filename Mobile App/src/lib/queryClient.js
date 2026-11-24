import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { AuthError } from './http.js';
import { clearSession } from './auth.js';

// Any /client/* call that comes back 401/403 surfaces as an AuthError.
// Handle it once here: clear the local session and let the router's auth
// gate redirect to /signin on next render (see App.jsx).
let onAuthError = () => {};
export function setAuthErrorHandler(fn) {
  onAuthError = fn;
}

function handleError(error) {
  if (error?.name !== 'AuthError' && !(error instanceof AuthError)) return;
  clearSession();
  onAuthError();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
});
