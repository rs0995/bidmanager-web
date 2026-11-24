/** Projects closed longer ago than this sink to the bottom of the list. */
export const CLOSED_GRACE_MS = 3 * 3_600_000;

/**
 * Project cards by closing: still open (or closed within the last 3 hours) soonest
 * first, then those with no closing date, then the ones closed more than 3 hours ago,
 * most recently closed first. `closesAt` gives a project's closing time in ms (or null).
 */
export function sortProjectsByClosing<T>(
  projects: T[],
  closesAt: (p: T) => number | null,
  now: number,
): T[] {
  const rank = (at: number | null) =>
    at === null ? 1 : at < now - CLOSED_GRACE_MS ? 2 : 0;
  return projects
    .map((p, i) => ({ p, i, at: closesAt(p) }))
    .sort((a, b) => {
      const ra = rank(a.at);
      const rb = rank(b.at);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.at as number) - (b.at as number);
      if (ra === 2) return (b.at as number) - (a.at as number);
      return a.i - b.i;
    })
    .map(x => x.p);
}
