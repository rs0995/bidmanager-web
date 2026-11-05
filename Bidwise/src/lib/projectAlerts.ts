import type { SharedProject } from './api';
import { addAlert } from './alerts';
import { isSignedIn, onSessionChange } from './auth';
import { getRaw, readJSON, removeRaw, writeJSON } from './kv';
import { getSettings } from './store';

// "New projects": an in-app alert (Alerts tab only, never a notification) when a
// project appears that someone else added, on another device or by another member of
// the organisation. This phone remembers the project ids it has seen; ones it makes
// itself are noted as they are created, so they never alert.

const KNOWN_KEY = 'bw.knownProjectIds';
export const PROJECT_ALERT_KEYS = [KNOWN_KEY];

/** From this many at once (joining an organisation), one alert instead of one each. */
const SUMMARY_FROM = 4;
const ARCHIVED = 'Archived';

// Signing out forgets them: the next account's first pull only records its projects.
onSessionChange(() => {
  if (!isSignedIn() && getRaw(KNOWN_KEY) !== null) removeRaw(KNOWN_KEY);
});

const readKnown = () => new Set(readJSON<number[]>(KNOWN_KEY, []));
const writeKnown = (ids: Set<number>) =>
  writeJSON(
    KNOWN_KEY,
    [...ids].sort((a, b) => a - b),
  );

/** A project made on this phone: never an alert. */
export function noteOwnProject(id: number) {
  // Before the first pull there is no list yet; that pull records everything anyway.
  if (getRaw(KNOWN_KEY) === null) return;
  const known = readKnown();
  known.add(id);
  writeKnown(known);
}

/**
 * After a pull: alerts for projects this phone hasn't seen (unless archived or the
 * setting is off), then remembers them all. The first pull only records.
 */
export function checkNewProjects(projects: SharedProject[]) {
  const ids = projects.map(p => Number(p.id)).filter(Number.isFinite);
  if (getRaw(KNOWN_KEY) === null) {
    writeKnown(new Set(ids));
    return;
  }
  const known = readKnown();
  const fresh = projects.filter(
    p => !known.has(Number(p.id)) && p.status !== ARCHIVED,
  );
  ids.forEach(id => known.add(id));
  writeKnown(known);
  if (!fresh.length || !getSettings().notifyProjectAlertsOn) return;
  if (fresh.length >= SUMMARY_FROM) {
    addAlert({
      kind: 'project',
      message: `${fresh.length} projects were added to Projects.`,
    });
    return;
  }
  fresh.forEach(p =>
    addAlert({
      kind: 'project',
      message: `“${p.title || 'Untitled project'}” was added to Projects.`,
      projectId: String(p.id),
    }),
  );
}
