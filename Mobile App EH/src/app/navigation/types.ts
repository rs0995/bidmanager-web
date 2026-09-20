import type { Portal } from '../../fixtures/tenders';

export type TabParamList = {
  Dashboard: undefined;
  Tenders: undefined;
  Projects: undefined;
  Alerts: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  TenderDetail: { id: string };
  OrgTenders: { name: string; portal: Portal };
  ClosingThisWeek: undefined;
  ProjectDetail: { id: string };
  FilePreview: { projectId: string; itemId: string };
};
