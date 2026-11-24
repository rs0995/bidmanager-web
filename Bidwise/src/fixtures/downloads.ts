// Phase 1 fixture data. Replaced by lib/documents.ts (real downloads via
// /client/tenders/{id}/download-request, stored on the device) in Phase 2.

export type DownloadStatus = 'done' | 'downloading' | 'queued' | 'failed';

export type DownloadItem = {
  id: string;
  tenderId: string;
  tenderShort: string;
  name: string;
  size: string;
  status: DownloadStatus;
  /** 0–1 while downloading. */
  progress?: number;
  when: string;
};

export const downloads: DownloadItem[] = [
  {
    id: 'd1',
    tenderId: '2024_PWD_1043567_1',
    tenderShort: 'Panvel–Uran road widening',
    name: 'Corrigendum I.pdf',
    size: '460 KB',
    status: 'downloading',
    progress: 0.62,
    when: 'Now',
  },
  {
    id: 'd2',
    tenderId: 'MJP/2024/WS/318',
    tenderShort: 'Chiplun 24 MLD water treatment plant',
    name: 'Technical specifications.pdf',
    size: '12.1 MB',
    status: 'queued',
    when: 'Now',
  },
  {
    id: 'd3',
    tenderId: '2024_PWD_1043567_1',
    tenderShort: 'Panvel–Uran road widening',
    name: 'NIT & instructions to bidders.pdf',
    size: '3.4 MB',
    status: 'done',
    when: 'Today, 10:42',
  },
  {
    id: 'd4',
    tenderId: 'eProc/CPWD/2024/2211',
    tenderShort: 'CPWD Nagpur staff quarters ph-II',
    name: 'Tender documents.zip',
    size: '18.6 MB',
    status: 'done',
    when: 'Yesterday',
  },
  {
    id: 'd5',
    tenderId: 'MCGM/SWD/2024/1567',
    tenderShort: 'K-West storm-water drains',
    name: 'BOQ.xls',
    size: '96 KB',
    status: 'failed',
    when: 'Yesterday',
  },
];

export const activeDownloads = (all: DownloadItem[]) =>
  all.filter(d => d.status === 'downloading' || d.status === 'queued');
