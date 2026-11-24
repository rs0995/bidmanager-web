import { hydrateAuth, isSignedIn } from './auth';
import { hydrateKV } from './kv';
import { DOCUMENT_KEYS, rehydrateDocuments, resumeJobs } from './documents';
import { QUEUE_KEYS } from './pushQueue';
import { PROJECT_KEYS, rehydrateProjects } from './sharedProjects';
import { rehydrateStore, STORE_KEYS } from './store';
import { autoSync, SYNC_KEYS, wireSyncTriggers } from './sync';
import { ALERT_KEYS, rehydrateAlerts } from './alerts';
import { ALERT_CHECK_KEYS } from './alertChecks';
import { queryClient } from './queryClient';
import {
  persistQueries,
  QUERY_CACHE_KEY,
  restoreQueries,
  setFollowedTenders,
} from './queryPersist';
import { checkForAlerts, followedIds } from './alertChecks';
import { initPush, maybeAskForPush, PUSH_KEYS } from './pushRegistration';
import {
  ORG_REQUEST_KEYS,
  rehydrateOrgRequests,
  resumeOrgRequests,
} from './orgRequests';
import { websitesQuery } from '../data/tenderSource';
import { ACCOUNT_KEYS, refreshAccount, rehydrateAccount } from './account';
// Checklist files on the server: registers its upload hooks and post-sync backfill.
import { PROJECT_FILE_KEYS } from './projectFiles';
import { PROJECT_ALERT_KEYS } from './projectAlerts';

/** Every AsyncStorage key the live stores read; cleared by Clear local cache. */
export const ALL_KEYS = [
  ...STORE_KEYS,
  ...PROJECT_KEYS,
  ...SYNC_KEYS,
  ...QUEUE_KEYS,
  ...DOCUMENT_KEYS,
  ...ALERT_KEYS,
  ...ALERT_CHECK_KEYS,
  ...PUSH_KEYS,
  ...ORG_REQUEST_KEYS,
  ...ACCOUNT_KEYS,
  ...PROJECT_FILE_KEYS,
  ...PROJECT_ALERT_KEYS,
  // Last portal chosen on Tenders / Archive (components/tender/PortalPicker.tsx).
  'bw.tendersLastPortal',
  // Last synced portals, organisations and tender pages (lib/queryPersist.ts).
  QUERY_CACHE_KEY,
];

/**
 * Live mode start-up: load device storage and the keychain session in parallel, re-prime
 * every store, wire foreground/background sync, then pull the latest from the server
 * (without blocking the first screen).
 */
export async function bootstrapLive() {
  await Promise.all([hydrateKV(ALL_KEYS), hydrateAuth()]);
  rehydrateStore();
  rehydrateProjects();
  rehydrateDocuments();
  rehydrateAlerts();
  rehydrateOrgRequests();
  rehydrateAccount();
  // Lists from the last sync show at once; react-query refreshes them behind.
  restoreQueries(queryClient);
  setFollowedTenders(followedIds);
  persistQueries(queryClient);
  // As BM Pro: warm the portal list before Tenders opens (instant when restored above).
  if (isSignedIn()) {
    queryClient.prefetchQuery(websitesQuery).catch(() => {});
    // The organisation may have changed this account's sections since last time.
    refreshAccount().catch(() => {});
  }
  wireSyncTriggers();
  // Push: send the APNs token when it arrives, keep the badge in step with unread
  // alerts. A notification arriving while the app is open refreshes alerts now.
  initPush(() => {
    checkForAlerts().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['captcha-pending'] });
  });
  if (isSignedIn()) {
    // After the first sync the account's alert choices are known: ask for push once if
    // they're on and this phone never was asked.
    autoSync()
      .then(() => maybeAskForPush())
      .catch(() => {});
    resumeJobs();
    resumeOrgRequests();
  }
}
