import type { Portal } from '../../fixtures/tenders';

export type TabParamList = {
  Dashboard: undefined;
  /** Optional preset, used by the Dashboard tiles. */
  Tenders: { view?: 'orgs' | 'tenders'; bookmarked?: boolean } | undefined;
  Projects: undefined;
  Alerts: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  TenderDetail: { id: string };
  /** `portal` omitted: show the organisation's tenders on every portal. */
  OrgTenders: { name: string; portal?: Portal };
  NewTenders: { alertId: string };
  Bookmarks: { view?: 'orgs' | 'tenders' } | undefined;
  Downloads: undefined;
  Account: undefined;
  Appearance: undefined;
  SignIn: undefined;
  AppLock: undefined;
  /** `entryName`: a PDF inside the downloaded ZIP. */
  DocumentView: { downloadId: string; entryName?: string };
  DocumentArchive: { downloadId: string };
  ClosingThisWeek: undefined;
  ProjectDetail: { id: string };
  FilePreview: { projectId: string; itemId: string };
};
