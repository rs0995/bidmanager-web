import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ServerTender } from '../lib/api';
import { parseFlexibleDate } from '../lib/serverTender';
import {
  canCheckNow,
  downloadAll,
  downloadDocument,
  isCorrupt,
  isZip,
  LocalDoc,
  openDocument,
  startJob,
  syncTenderDocuments,
  useActiveDownloads,
  useDocJob,
  useDocsForTender,
  useDownloadHistory,
  zipEntries,
  lastCheckedAt,
} from '../lib/documents';
import { files } from '../platform/files';
import { exportTenders, ExportScope } from '../lib/exportCsv';
import { tenders as sampleTenders } from '../fixtures/tenders';
import {
  downloads as sampleDownloads,
  DownloadItem,
} from '../fixtures/downloads';
import type { Tender } from '../fixtures/tenders';
import { formatDateTime } from '../lib/serverTender';

// Tender documents for the screens: each file's state on this device and the actions
// (download, open, request from the portal, check for updates, export). Demo mode
// simulates them on the sample data; live mode uses lib/documents.ts.

export type DocState =
  | 'remote'
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'unavailable';

export type DocView = {
  key: string;
  name: string;
  meta: string;
  state: DocState;
  zip: boolean;
  fresh?: boolean;
  error?: string | null;
};

export type TenderDocs = {
  rows: DocView[];
  loading: boolean;
  /** The server has no files for this tender yet: offer "Request documents". */
  canRequest: boolean;
  /** A server job (request / re-download / update check) is running. */
  job: 'request' | 'redownload' | 'update' | null;
  hasCorrupt: boolean;
  /** Files listed on the server that aren't on this device yet. */
  missing: number;
  download: (key: string) => Promise<void>;
  /** Opens the file; resolves 'zip' when it should be browsed instead. */
  open: (key: string) => Promise<'opened' | 'zip'>;
  downloadAll: () => Promise<string>;
  request: () => Promise<string>;
  redownload: () => Promise<string>;
  /** Resolves with a short message for a toast. */
  checkUpdates: () => Promise<string>;
};

export type ZipEntry = { name: string; path: string; size: number };

export type DocsSource = {
  useTenderDocs: (tender?: Tender) => TenderDocs;
  useDownloads: () => {
    items: DownloadItem[];
    active: number;
    open: (id: string) => Promise<'opened' | 'zip'>;
    retry: (id: string) => Promise<void>;
  };
  useZip: (docId: string) => {
    entries: ZipEntry[];
    loading: boolean;
    error: string | null;
  };
  openFile: (path: string) => Promise<void>;
  /** Writes the chosen tenders as CSV and opens the share sheet; resolves the count. */
  exportCsv: (
    scope: ExportScope,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<number>;
};

const fmtBytes = (b: number) =>
  !b
    ? ''
    : b < 1024 * 1024
    ? `${Math.max(1, Math.round(b / 1024))} KB`
    : `${(b / 1048576).toFixed(1)} MB`;
/**
 * "08 Sep 2026": when the server picked the file up from the portal, so a corrigendum
 * or pre-bid reply shows the day it appeared (as BM Pro's document rows).
 */
export function docDate(at: string | null | undefined): string {
  const d = parseFlexibleDate(at);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${
    MONTHS[d.getMonth()]
  } ${d.getFullYear()}`;
}
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Demo ---

function useDemoTenderDocs(tender?: Tender): TenderDocs {
  const [state, setState] = useState<Record<string, DocState>>({});
  const rows = (tender?.docs ?? []).map<DocView>(d => ({
    key: d.name,
    name: d.name,
    meta: d.meta,
    state: state[d.name] ?? 'remote',
    zip: isZip(d.name),
    fresh: /corrigend/i.test(d.meta),
  }));
  const set = (key: string, s: DocState) => setState(p => ({ ...p, [key]: s }));
  return {
    rows,
    loading: false,
    canRequest: false,
    job: null,
    hasCorrupt: false,
    missing: rows.filter(r => r.state !== 'downloaded').length,
    download: async key => {
      set(key, 'downloading');
      await wait(700);
      set(key, 'downloaded');
    },
    open: async key => (isZip(key) ? 'zip' : 'opened'),
    downloadAll: async () => {
      rows.forEach(r => set(r.key, 'downloaded'));
      return `${rows.length} files saved to this device`;
    },
    request: async () => 'Requested from the portal',
    redownload: async () => 'Re-download started',
    checkUpdates: async () => 'Tender is up to date',
  };
}

const demoSource: DocsSource = {
  useTenderDocs: useDemoTenderDocs,
  useDownloads: () => ({
    items: sampleDownloads,
    active: sampleDownloads.filter(
      d => d.status === 'downloading' || d.status === 'queued',
    ).length,
    open: async () => 'opened',
    retry: async () => {},
  }),
  useZip: () => ({
    entries: [
      { name: 'NIT.pdf', path: 'NIT.pdf', size: 524_288 },
      {
        name: 'Drawings/Site plan.pdf',
        path: 'Site plan.pdf',
        size: 2_202_009,
      },
      { name: 'BOQ.xls', path: 'BOQ.xls', size: 90_112 },
    ],
    loading: false,
    error: null,
  }),
  openFile: async () => {},
  exportCsv: async scope => {
    await wait(700);
    if (scope.kind === 'bookmarked') return 4;
    if (scope.kind === 'projects') return 6;
    return sampleTenders.filter(t => scope.orgs.some(o => o.name === t.org))
      .length;
  },
};

// --- Live ---

function useLiveTenderDocs(tender?: Tender): TenderDocs {
  const qc = useQueryClient();
  const tid = Number(tender?.id);
  const local = useDocsForTender(tid);
  const job = useDocJob(tid);
  const server = useQuery({
    queryKey: ['tender-docs', tender?.id],
    enabled: Number.isFinite(tid),
    queryFn: () => api.tenderDocuments(tid, { page_size: 100 }),
  });
  const items = useMemo(() => server.data?.items ?? [], [server.data]);
  const serverTender = useMemo(
    () => ({
      id: tid,
      tender_id: tender?.refId ?? '',
      title: tender?.title ?? '',
    }),
    [tid, tender?.refId, tender?.title],
  );

  useEffect(() => {
    if (items.length) syncTenderDocuments(serverTender, items);
  }, [items, serverTender]);

  const byId = useMemo(() => new Map(local.map(d => [d.id, d])), [local]);
  const rows = items.map<DocView>(it => {
    const l = byId.get(it.id);
    const state: DocState = !it.downloadable
      ? 'unavailable'
      : l?.status === 'downloaded' && !isCorrupt(l)
      ? 'downloaded'
      : l?.status === 'downloading'
      ? 'downloading'
      : l?.status === 'failed' || (l && isCorrupt(l))
      ? 'failed'
      : 'remote';
    return {
      key: String(it.id),
      name: it.name,
      meta: [
        it.type !== 'document' ? it.type : '',
        fmtBytes(it.size_bytes),
        docDate(it.downloaded_at),
        state === 'unavailable' ? 'not available yet' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      state,
      zip: isZip(it.name),
      fresh: /corrigend/i.test(`${it.name} ${it.type}`),
      error: l?.error,
    };
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['tender-docs', tender?.id] });
    qc.invalidateQueries({ queryKey: ['tender', tender?.id] });
  }, [qc, tender?.id]);

  const run = (kind: 'request' | 'redownload' | 'update') =>
    new Promise<string>((resolve, reject) => {
      startJob(serverTender, kind, () => refresh())
        .then(() =>
          resolve(
            kind === 'update'
              ? 'Checking the portal for new corrigenda and pre-bid files'
              : kind === 'redownload'
              ? 'Fresh copies requested from the portal'
              : 'Requested from the portal — this can take a few minutes',
          ),
        )
        .catch(reject);
    });

  const docFor = (key: string) => {
    const it = items.find(d => String(d.id) === key);
    if (!it) throw new Error('This document is no longer listed.');
    return it;
  };

  return {
    rows,
    loading: server.isLoading,
    canRequest:
      !server.isLoading &&
      items.length === 0 &&
      !tender?.archived &&
      Number.isFinite(tid),
    job: job?.kind ?? null,
    hasCorrupt: local.some(isCorrupt),
    missing: rows.filter(r => r.state === 'remote' || r.state === 'failed')
      .length,
    download: async key => {
      const it = docFor(key);
      await downloadDocument({
        id: it.id,
        tender_db_id: tid,
        file_name: it.name,
        size_bytes: it.size_bytes,
        tender_ref: serverTender.tender_id,
        tender_title: serverTender.title,
      });
    },
    open: async key => {
      const l = byId.get(Number(key));
      if (!l || l.status !== 'downloaded')
        throw new Error('Download it first.');
      if (isZip(l.file_name)) return 'zip';
      await openDocument(l);
      return 'opened';
    },
    downloadAll: async () => {
      const { ok, total } = await downloadAll(serverTender, items);
      return total === 0
        ? 'Everything is already on this device'
        : `${ok} of ${total} files saved to this device`;
    },
    request: () => run('request'),
    redownload: () => run('redownload'),
    checkUpdates: async () => {
      if (job) return 'Already checking this tender';
      if (!canCheckNow(tid)) {
        const fresh = await qc.fetchQuery({
          queryKey: ['tender', tender?.id],
          queryFn: () => api.tender(tid),
          staleTime: 0,
        });
        const at = lastCheckedAt(fresh as ServerTender);
        return `No updates available. Last checked ${
          at ? formatDateTime(new Date(at).toISOString()) : 'recently'
        }.`;
      }
      return run('update');
    },
  };
}

function useLiveDownloads() {
  const history = useDownloadHistory();
  const activeRows = useActiveDownloads();
  const find = (id: string) => history.find(d => String(d.id) === id);
  const items = history.map<DownloadItem>(d => ({
    id: String(d.id),
    tenderId: String(d.tender_db_id),
    tenderShort: d.tender_title || d.tender_ref || `Tender ${d.tender_db_id}`,
    name: d.file_name,
    size: fmtBytes(d.local_size || d.size_bytes),
    status:
      d.status === 'downloaded' && isCorrupt(d)
        ? 'failed'
        : d.status === 'downloaded'
        ? 'done'
        : d.status === 'downloading'
        ? 'downloading'
        : 'failed',
    when: d.downloaded_at
      ? formatDateTime(d.downloaded_at)
      : formatDateTime(d.updated_at),
  }));
  return {
    items,
    active: activeRows.length,
    open: async (id: string) => {
      const d = find(id);
      if (!d) throw new Error('Not found.');
      if (isZip(d.file_name)) return 'zip' as const;
      await openDocument(d);
      return 'opened' as const;
    },
    retry: async (id: string) => {
      const d = find(id);
      if (d) await downloadDocument(d as LocalDoc);
    },
  };
}

function useLiveZip(docId: string) {
  const history = useDownloadHistory();
  const doc = history.find(d => String(d.id) === docId);
  const res = useQuery({
    queryKey: ['zip', docId],
    enabled: Boolean(doc),
    staleTime: Infinity,
    queryFn: () => zipEntries(doc!),
  });
  return {
    entries: res.data ?? [],
    loading: res.isLoading,
    error: res.error
      ? (res.error as Error).message
      : doc
      ? null
      : 'Download the ZIP first.',
  };
}

const liveSource: DocsSource = {
  useTenderDocs: useLiveTenderDocs,
  useDownloads: useLiveDownloads,
  useZip: useLiveZip,
  openFile: path => files.open(path),
  exportCsv: (scope, onProgress) => exportTenders(scope, onProgress),
};

const DocsContext = createContext<DocsSource>(demoSource);

export function DocsProvider({
  mode,
  children,
}: {
  mode: 'demo' | 'live';
  children: React.ReactNode;
}) {
  return (
    <DocsContext.Provider value={mode === 'live' ? liveSource : demoSource}>
      {children}
    </DocsContext.Provider>
  );
}

/** The active source; its mode never changes while the app runs. */
export const useDocs = () => useContext(DocsContext);
