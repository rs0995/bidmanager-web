import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Phase 1 only: in-memory download history. Replaced by lib/documents.ts (job polling,
// real files on disk) in Phase 2F.

export type DownloadStatus =
  | 'requested'
  | 'downloading'
  | 'downloaded'
  | 'failed';

export type DownloadKind = 'pdf' | 'zip' | 'other';

export type ArchiveEntry = { name: string; size: string };

export type DownloadItem = {
  id: string;
  tenderId: string;
  tenderTitle: string;
  /** "All documents" when the whole tender was requested. */
  fileName: string;
  kind: DownloadKind;
  status: DownloadStatus;
  when: string;
  error?: string;
  /** ZIP downloads only: the files inside. */
  entries?: ArchiveEntry[];
};

const seed: DownloadItem[] = [
  {
    id: 'd1',
    tenderId: '2024_PWD_1043567_1',
    tenderTitle: 'Panvel–Uran road widening',
    fileName: 'NIT & instructions to bidders.pdf',
    kind: 'pdf',
    status: 'downloaded',
    when: '12 min ago',
  },
  {
    id: 'd2',
    tenderId: 'eProc/CPWD/2024/2211',
    tenderTitle: 'CPWD Nagpur staff quarters ph-II',
    fileName: 'All documents',
    kind: 'zip',
    status: 'downloaded',
    when: '1h ago',
    entries: [
      { name: 'Tender notice.pdf', size: '1.2 MB' },
      { name: 'NIT & instructions to bidders.pdf', size: '3.4 MB' },
      { name: 'Special conditions.pdf', size: '740 KB' },
      { name: 'BOQ.xls', size: '88 KB' },
      { name: 'Site drawings.dwg', size: '5.1 MB' },
    ],
  },
  {
    id: 'd3',
    tenderId: '2024_PWD_1041902_1',
    tenderTitle: 'Kal river bridge, Mahad',
    fileName: 'BOQ.xls',
    kind: 'other',
    status: 'downloading',
    when: 'just now',
  },
  {
    id: 'd4',
    tenderId: 'MCGM/SWD/2024/1567',
    tenderTitle: 'K-West storm-water drains',
    fileName: 'Tender notice.pdf',
    kind: 'pdf',
    status: 'requested',
    when: '3 min ago',
  },
  {
    id: 'd5',
    tenderId: 'MJP/2024/WS/318',
    tenderTitle: 'Chiplun 24 MLD water treatment plant',
    fileName: 'Corrigendum I.pdf',
    kind: 'pdf',
    status: 'failed',
    when: 'Yesterday',
    error: 'The portal did not respond. Try again later.',
  },
];

function kindOf(fileName: string): DownloadKind {
  if (/\.pdf$/i.test(fileName)) return 'pdf';
  if (/\.zip$/i.test(fileName) || fileName === 'All documents') return 'zip';
  return 'other';
}

type Ctx = {
  downloads: DownloadItem[];
  /** Downloads still being requested or fetched. */
  active: number;
  getDownload: (id: string) => DownloadItem | undefined;
  /** Asks for a tender document; it appears as "Requested" until the next update. */
  request: (tenderId: string, tenderTitle: string, fileName: string) => void;
};

const DownloadsContext = createContext<Ctx>({
  downloads: [],
  active: 0,
  getDownload: () => undefined,
  request: () => {},
});

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>(seed);

  const request = useCallback(
    (tenderId: string, tenderTitle: string, fileName: string) => {
      setDownloads(prev => [
        {
          id: `d${prev.length + 1}-${Date.now()}`,
          tenderId,
          tenderTitle,
          fileName,
          kind: kindOf(fileName),
          status: 'requested',
          when: 'just now',
        },
        ...prev,
      ]);
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      downloads,
      active: downloads.filter(
        d => d.status === 'requested' || d.status === 'downloading',
      ).length,
      getDownload: id => downloads.find(d => d.id === id),
      request,
    }),
    [downloads, request],
  );

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
}

export const useDownloads = () => useContext(DownloadsContext);
