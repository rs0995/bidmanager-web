import type { ChecklistFolder, Project } from '../fixtures/projects';
import { DEFAULT_FOLDERS } from '../fixtures/projects';

// Pure checklist maths, independent of where projects are stored.

export type Progress = { done: number; total: number; pct: number };

export function checklistProgress(checklist: ChecklistFolder[]): Progress {
  let total = 0;
  let done = 0;
  checklist.forEach(f =>
    f.items.forEach(i => {
      total += 1;
      if (i.done) done += 1;
    }),
  );
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export const projectProgress = (p: Project) => checklistProgress(p.checklist);

/** Section names offered when adding an item: defaults first, then any custom ones. */
export function folderNames(p: Project): string[] {
  return [...new Set([...DEFAULT_FOLDERS, ...p.checklist.map(f => f.name)])];
}
