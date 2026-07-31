import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Notification {
  id: string;
  type: 'closing' | 'new' | 'status' | 'prebid' | 'info';
  message: string;
  time: string;
  read: boolean;
}

interface AppState {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  notifications: Notification[];
  tendersTable: {
    hiddenColumns: string[];
    columnOrder: string[];
  };
  projectsTable: {
    hiddenColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
  };
  serverStorageTable: {
    hiddenColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
  };
  tendersView: {
    tab: 'orgs' | 'active' | 'archived' | 'logs';
    selectedWebsiteId: number | 'ALL';
    highlightedOrgIdsByWebsite: Record<string, number[]>;
    highlightedTenderIdsByWebsite: Record<string, number[]>;
    orgColumnWidths: {
      name: number;
      tenders: number;
      select: number;
    };
    tenderColumnWidths: Record<string, number>;
  };

  setTheme: (t: 'dark' | 'light') => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  addNotification: (n: Omit<Notification, 'id'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setTendersHiddenColumns: (hiddenColumns: string[]) => void;
  setTendersColumnOrder: (columnOrder: string[]) => void;
  setProjectsHiddenColumns: (hiddenColumns: string[]) => void;
  setProjectsColumnOrder: (columnOrder: string[]) => void;
  setProjectsColumnWidth: (columnKey: string, width: number) => void;
  setServerStorageHiddenColumns: (hiddenColumns: string[]) => void;
  setServerStorageColumnOrder: (columnOrder: string[]) => void;
  setServerStorageColumnWidth: (columnKey: string, width: number) => void;
  setTendersViewTab: (tab: AppState['tendersView']['tab']) => void;
  setTendersViewWebsite: (selectedWebsiteId: number | 'ALL') => void;
  setHighlightedOrgIdsForWebsite: (websiteId: number, orgIds: number[]) => void;
  setHighlightedTenderIdsForWebsite: (websiteId: number, tenderDbIds: number[]) => void;
  setOrgColumnWidths: (widths: Partial<AppState['tendersView']['orgColumnWidths']>) => void;
  setTenderColumnWidth: (columnKey: string, width: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      notifications: [
        { id: '1', type: 'closing', message: 'Tender closing in 3 days: check deadlines', time: '2h ago', read: false },
        { id: '2', type: 'new', message: 'New tenders available from latest scrape', time: '4h ago', read: false },
        { id: '3', type: 'status', message: 'Status updated for downloaded tenders', time: '1d ago', read: true },
      ],
      tendersTable: {
        hiddenColumns: [],
        columnOrder: [],
      },
      projectsTable: {
        hiddenColumns: [],
        columnOrder: [],
        columnWidths: {},
      },
      serverStorageTable: {
        hiddenColumns: [],
        columnOrder: [],
        columnWidths: {},
      },
      tendersView: {
        tab: 'active',
        selectedWebsiteId: 'ALL',
        highlightedOrgIdsByWebsite: {},
        highlightedTenderIdsByWebsite: {},
        orgColumnWidths: {
          name: 460,
          tenders: 140,
          select: 110,
        },
        tenderColumnWidths: {},
      },

      setTheme: (t) => set({ theme: t }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      addNotification: (n) =>
        set((s) => ({
          notifications: [{ ...n, id: Date.now().toString() }, ...s.notifications],
        })),
      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
        })),
      setTendersHiddenColumns: (hiddenColumns) =>
        set((s) => ({ tendersTable: { ...s.tendersTable, hiddenColumns } })),
      setTendersColumnOrder: (columnOrder) =>
        set((s) => ({ tendersTable: { ...s.tendersTable, columnOrder } })),
      setProjectsHiddenColumns: (hiddenColumns) =>
        set((s) => ({ projectsTable: { ...s.projectsTable, hiddenColumns } })),
      setProjectsColumnOrder: (columnOrder) =>
        set((s) => ({ projectsTable: { ...s.projectsTable, columnOrder } })),
      setProjectsColumnWidth: (columnKey, width) =>
        set((s) => ({
          projectsTable: {
            ...s.projectsTable,
            columnWidths: {
              ...s.projectsTable.columnWidths,
              [String(columnKey)]: Number(width),
            },
          },
        })),
      setServerStorageHiddenColumns: (hiddenColumns) =>
        set((s) => ({ serverStorageTable: { ...s.serverStorageTable, hiddenColumns } })),
      setServerStorageColumnOrder: (columnOrder) =>
        set((s) => ({ serverStorageTable: { ...s.serverStorageTable, columnOrder } })),
      setServerStorageColumnWidth: (columnKey, width) =>
        set((s) => ({
          serverStorageTable: {
            ...s.serverStorageTable,
            columnWidths: {
              ...s.serverStorageTable.columnWidths,
              [String(columnKey)]: Number(width),
            },
          },
        })),
      setTendersViewTab: (tab) =>
        set((s) => ({ tendersView: { ...s.tendersView, tab } })),
      setTendersViewWebsite: (selectedWebsiteId) =>
        set((s) => ({ tendersView: { ...s.tendersView, selectedWebsiteId } })),
      setHighlightedOrgIdsForWebsite: (websiteId, orgIds) =>
        set((s) => ({
          tendersView: {
            ...s.tendersView,
            highlightedOrgIdsByWebsite: {
              ...s.tendersView.highlightedOrgIdsByWebsite,
              [String(websiteId)]: Array.from(new Set(orgIds)),
            },
          },
        })),
      setHighlightedTenderIdsForWebsite: (websiteId, tenderDbIds) =>
        set((s) => ({
          tendersView: {
            ...s.tendersView,
            highlightedTenderIdsByWebsite: {
              ...s.tendersView.highlightedTenderIdsByWebsite,
              [String(websiteId)]: Array.from(new Set(tenderDbIds)),
            },
          },
        })),
      setOrgColumnWidths: (widths) =>
        set((s) => ({
          tendersView: {
            ...s.tendersView,
            orgColumnWidths: { ...s.tendersView.orgColumnWidths, ...widths },
          },
        })),
      setTenderColumnWidth: (columnKey, width) =>
        set((s) => ({
          tendersView: {
            ...s.tendersView,
            tenderColumnWidths: {
              ...s.tendersView.tenderColumnWidths,
              [String(columnKey)]: Number(width),
            },
          },
        })),
    }),
    {
      name: 'bidmanager-ui',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        tendersTable: state.tendersTable,
        projectsTable: state.projectsTable,
        serverStorageTable: state.serverStorageTable,
        tendersView: state.tendersView,
      }),
    }
  )
);
