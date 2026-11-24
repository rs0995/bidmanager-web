import type { Project } from '../fixtures/projects';
import type { Tender } from '../fixtures/tenders';
import { hoursUntilClose } from './deadlines';

/** Tenders closing within this many hours need attention (5 days). */
export const ATTENTION_HOURS = 5 * 24;
/** The card's ring counts down over 6 days, so at 5 days left it is already filling. */
export const RING_HOURS = 6 * 24;

/** Share of the ring filled for a tender closing in `hours` (0 at 6+ days, 1 at close). */
export const ringProgress = (hours: number) =>
  1 - Math.min(Math.max(hours, 0), RING_HOURS) / RING_HOURS;

export type AttentionItem = {
  tender: Tender;
  /** `crit` closes within a day, `soon` within five. */
  level: 'crit' | 'soon';
  /** Project already started for this tender, if any. */
  project?: Project;
};

/** Still open with a known deadline ("Closed" and "—" would read as 0 hours left). */
export const hasDeadline = (t: Tender) =>
  Boolean(t.closeIn) && t.closeIn !== 'Closed' && t.closeIn !== '—';

const attachedCount = (p: Project) =>
  p.checklist.reduce((n, f) => n + f.items.filter(i => !!i.file).length, 0);

/**
 * Bookmarked tenders closing within 5 days that have no documents attached yet
 * (no project, or a project with no attached files). Most urgent first.
 */
export function needsAttention(
  tenders: Tender[],
  projects: Project[],
  isBookmarked: (id: string) => boolean,
): AttentionItem[] {
  return tenders
    .filter(
      t =>
        hasDeadline(t) &&
        (isBookmarked(t.id) || projects.some(p => p.sourceTenderId === t.id)),
    )
    .map(t => ({
      tender: t,
      hours: hoursUntilClose(t.closeIn),
      project: projects.find(p => p.sourceTenderId === t.id),
    }))
    .filter(
      x =>
        x.hours <= ATTENTION_HOURS &&
        (!x.project || attachedCount(x.project) === 0),
    )
    .sort((a, b) => a.hours - b.hours)
    .map(x => ({
      tender: x.tender,
      level: x.hours <= 24 ? ('crit' as const) : ('soon' as const),
      project: x.project,
    }));
}
