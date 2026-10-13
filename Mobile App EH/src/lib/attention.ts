import type { Project } from '../fixtures/projects';
import type { Tender } from '../fixtures/tenders';
import { hoursUntilClose } from './deadlines';

export type AttentionItem = {
  tender: Tender;
  /** `crit` closes within a day, `soon` within three. */
  level: 'crit' | 'soon';
  /** Project already started for this tender, if any. */
  project?: Project;
};

const attachedCount = (p: Project) =>
  p.checklist.reduce((n, f) => n + f.items.filter(i => !!i.file).length, 0);

/**
 * Bookmarked tenders closing within 3 days that have no documents attached yet
 * (no project, or a project with no attached files). Most urgent first.
 */
export function needsAttention(
  tenders: Tender[],
  projects: Project[],
  isBookmarked: (id: string) => boolean,
): AttentionItem[] {
  return tenders
    .filter(
      t => isBookmarked(t.id) || projects.some(p => p.sourceTenderId === t.id),
    )
    .map(t => ({
      tender: t,
      hours: hoursUntilClose(t.closeIn),
      project: projects.find(p => p.sourceTenderId === t.id),
    }))
    .filter(
      x => x.hours <= 72 && (!x.project || attachedCount(x.project) === 0),
    )
    .sort((a, b) => a.hours - b.hours)
    .map(x => ({
      tender: x.tender,
      level: x.hours <= 24 ? ('crit' as const) : ('soon' as const),
      project: x.project,
    }));
}
