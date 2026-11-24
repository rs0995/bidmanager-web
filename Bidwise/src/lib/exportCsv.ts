import { api, ServerTender } from './api';
import { getBookmarks } from './store';
import { getProjectsState, STATUS_ARCHIVED } from './sharedProjects';
import { toCsv } from './documents';
import { files } from '../platform/files';

// CSV export of a chosen set of tenders, with BM Pro's columns, handed to the iOS share
// sheet: saved (bookmarked) tenders, tenders behind projects, or every tender of the
// organisations the user picked (from any portal).

export type ExportOrg = { name: string; websiteId: number };

export type ExportScope =
  | { kind: 'bookmarked' }
  | { kind: 'projects' }
  | { kind: 'orgs'; orgs: ExportOrg[]; includeClosed: boolean };

const MAX_PAGES_PER_ORG = 50;

/** Server tender ids behind the user's projects (archived projects left out). */
export function projectTenderIds(): number[] {
  return [
    ...new Set(
      getProjectsState()
        .projects.filter(
          p => p.status !== STATUS_ARCHIVED && p.source_tender_db_id,
        )
        .map(p => Number(p.source_tender_db_id)),
    ),
  ];
}

async function byIds(ids: number[]): Promise<ServerTender[]> {
  const out: ServerTender[] = [];
  for (const id of ids) {
    try {
      out.push(await api.tender(id));
    } catch {
      // Removed from the server: skip it rather than fail the whole export.
    }
  }
  return out;
}

const sameOrg = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every tender of one organisation on one portal (the server matches by substring). */
async function forOrg(
  org: ExportOrg,
  includeClosed: boolean,
): Promise<ServerTender[]> {
  const out: ServerTender[] = [];
  let page = 1;
  let pages = 1;
  do {
    const res = await api.tenders({
      organization: org.name,
      website_id: org.websiteId,
      archived: includeClosed ? undefined : 'false',
      sort_by: 'closing_date',
      sort_order: 'asc',
      page,
      page_size: 100,
    });
    out.push(...res.items.filter(t => sameOrg(t.organization, org.name)));
    pages = Math.max(1, res.pages || 1);
    page += 1;
  } while (page <= pages && page <= MAX_PAGES_PER_ORG);
  return out;
}

export async function collectTenders(
  scope: ExportScope,
  onProgress?: (done: number, total: number) => void,
): Promise<ServerTender[]> {
  let rows: ServerTender[] = [];
  if (scope.kind === 'bookmarked') rows = await byIds([...getBookmarks()]);
  else if (scope.kind === 'projects') rows = await byIds(projectTenderIds());
  else {
    for (let i = 0; i < scope.orgs.length; i++) {
      onProgress?.(i, scope.orgs.length);
      rows.push(...(await forOrg(scope.orgs[i], scope.includeClosed)));
    }
    onProgress?.(scope.orgs.length, scope.orgs.length);
  }
  const seen = new Set<number>();
  return rows.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function exportFileName(scope: ExportScope, date = new Date()) {
  const what =
    scope.kind === 'bookmarked'
      ? 'bookmarked'
      : scope.kind === 'projects'
      ? 'projects'
      : scope.orgs.length === 1
      ? scope.orgs[0].name
          .replace(/[^\w-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'organisation'
      : 'organisations';
  return `tenders-${what}-${date.toISOString().slice(0, 10)}.csv`;
}

/** Writes the CSV and opens the share sheet. Resolves with the number of tenders. */
export async function exportTenders(
  scope: ExportScope,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const rows = await collectTenders(scope, onProgress);
  if (!rows.length) return 0;
  const abs = files.abs(`exports/${exportFileName(scope)}`);
  await files.writeText(abs, toCsv(rows));
  files.share(abs);
  return rows.length;
}
