import { hydrateKV } from "./kv.js";
import { hydrateAuth } from "./auth.js";
import { rehydrateStore } from "./store.js";
import { rehydrateAlerts } from "./alerts.js";
import { rehydrateProjects } from "./projects.js";
import { rehydrateOrgRequests } from "./orgRequests.js";
import { rehydrateDocuments } from "./documents.js";
import { rehydrateSync } from "./sync.js";

// The full list of AsyncStorage keys the kv.js mirror needs loaded before any
// module reading through it is trustworthy. Kept in one place since kv.js
// itself does not know which modules use which keys.
const KV_KEYS = [
  "bm.bookmarks", "bm.bookmarkedOrgs", "bm.orgIdByName", "bm.settings",
  "bm.alerts",
  "bm.projects", "bm.checklist",
  "bm.pendingOrgRequests",
  "bm.documents",
  "bm.syncBlob", "bm.syncBase", "bm.syncDirty", "bm.tenderSnapshot", "bm.lastChangesAt",
  "bm.remindersFired",
];

// Call once at app startup, before rendering anything that reads from these
// modules (see src/app/_layout.tsx). Awaits both storage backends (the kv.js
// AsyncStorage mirror and auth.js expo-secure-store mirror) in parallel,
// then re-primes every module cache from the now-populated data.
export async function bootstrapApp() {
  await Promise.all([hydrateKV(KV_KEYS), hydrateAuth()]);
  rehydrateStore();
  rehydrateAlerts();
  rehydrateProjects();
  rehydrateOrgRequests();
  rehydrateDocuments();
  rehydrateSync();
}
