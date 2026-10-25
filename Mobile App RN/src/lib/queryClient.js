import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { AuthError } from "./http.js";
import { clearSession } from "./auth.js";
import { isSyncPaused } from "./syncPause.js";

// Any /client/* call that comes back 401/403 surfaces as an AuthError.
// Handle it once here: clear the local session and let the router auth
// gate redirect to /sign-in on next render (see src/app/_layout.tsx).
let onAuthError = () => {};
export function setAuthErrorHandler(fn) {
  onAuthError = fn;
}

function handleError(error) {
  if (error?.name !== "AuthError" && !(error instanceof AuthError)) return;
  clearSession();
  onAuthError();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    // Paused after Clear local cache until the next manual sync (syncPause.js).
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1, enabled: () => !isSyncPaused() },
  },
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
});
