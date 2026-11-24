import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearSession } from './auth';
import { AuthError } from './http';
import { isSyncPaused } from './pushQueue';

// Any /client/* call answered 401/403 surfaces as an AuthError: clear the session here,
// once, and the navigator falls back to Sign in (it watches useSignedIn()).
function handleError(error: unknown) {
  if (error instanceof AuthError || (error as Error)?.name === 'AuthError') {
    clearSession();
  }
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        // Paused after Clear local cache until the next manual Sync tenders.
        enabled: () => !isSyncPaused(),
      },
    },
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
  });
}

export const queryClient = createQueryClient();
