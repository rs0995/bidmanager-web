import { setSyncPaused } from "./syncPause.js";
import { syncNow } from "./sync.js";
import { queryClient } from "./queryClient.js";

// The manual Sync action: lifts the pause left by Clear local cache, pulls
// favourites/projects and runs the change check, then refetches every list
// that was left empty while paused. Automatic syncing carries on as normal
// from here.
export async function resumeSync() {
  setSyncPaused(false);
  const result = await syncNow();
  await queryClient.invalidateQueries();
  return result;
}
