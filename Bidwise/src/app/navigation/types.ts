import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Dashboard: undefined;
  /** Optional preset, used by the Dashboard tiles. */
  Tenders:
    | {
        view?: 'orgs' | 'tenders';
        bookmarked?: boolean;
      }
    | undefined;
  Projects: undefined;
  More: undefined;
};

export type RootStackParamList = {
  SignIn: undefined;
  /** Create an account: individual, or an organisation with this account as admin. */
  SignUp: undefined;
  /** Create / join an organisation, or manage it (admins). */
  Organisation: undefined;
  /** Search a tender ID on a NIC portal (the portal_search section). */
  PortalSearch: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** Alerts (the dashboard bell, notification taps). */
  Alerts: undefined;
  /** The Bid Agent hub (the tab bar's centre button): find a tender, recent chats. */
  BidAgentHub: undefined;
  /** The agent's instructions, learned notes, reference documents and templates. */
  BidAgentSettings: undefined;
  TenderDetail: { id: string };
  /** The same detail screen, opened from Projects. */
  ProjectDetail: { id: string };
  /** The Dashboard's "Closing this week" tile. */
  ClosingThisWeek: undefined;
  Downloads: undefined;
  Archive: undefined;
  Captcha: undefined;
  NotificationSettings: undefined;
  /** CSV export: bookmarked, in projects, or selected organisations. */
  Export: undefined;
  /** Every tender needing attention (the Dashboard card's "See more"). */
  NeedsAttention: undefined;
  /** The Bid Agent chat for a tender (opened from the card above Ready for Bid). */
  BidAgentChat: { tenderId: string; projectId?: number | null; title?: string; prefill?: string };
  /** Files inside a downloaded ZIP. */
  ZipContents: { docId: string; name: string };
  /** One organisation's tenders (tapping an organisation row, as BM Pro). */
  OrgTenders: { org: string; portal?: string; archived?: boolean };
  /** Archived projects (Projects' archive button): restore or delete them. */
  ArchivedProjects: undefined;
  /** Bookmarked organisations and tenders (the Dashboard's Bookmarks tile). */
  Bookmarks: { view?: 'orgs' | 'tenders' } | undefined;
  /**
   * New tenders under an organisation: from an alert (`alertId`), or from a
   * notification (`org`), which syncs first since its alert may not be built yet.
   */
  NewTenders: { alertId?: string; org?: string };
};
