import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Server: undefined;
  Scraper: undefined;
  Users: undefined;
  Jobs: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Connect: undefined;
  Archive: undefined;
  Captchas: undefined;
  UserDetail: { userId: number };
  UserSyncList: {
    userId: number;
    section: 'bookmarks' | 'orgs' | 'projects' | 'templates' | 'activity';
  };
  JobDetail: { jobId: number };
  OrgDetail: { orgId: number };
  Logs: undefined;
  Settings: undefined;
  /** No jobId = create a new saved job. */
  CustomJobEditor: { jobId?: number; websiteId: number };
};
