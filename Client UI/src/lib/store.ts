import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Notification {
  id: string;
  type: 'closing' | 'new' | 'status' | 'prebid' | 'info';
  message: string;
  time: string;
  read: boolean;
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
}

interface AppState {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  notifications: Notification[];
  toasts: Toast[];
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
  organizationsTable: {
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
  // Small floating auto-dismissing card (ToastHost in App.jsx) — for direct
  // feedback on a user-initiated action, distinct from the notifications
  // bell (addNotification), which is for passive background events the
  // user opens the dropdown to see. Callable from non-React code (api.js)
  // since the auto-dismiss timer lives in the action itself, not a
  // component's lifecycle.
  pushToast: (t: Omit<Toast, 'id'> & { duration?: number }) => void;
  dismissToast: (id: string) => void;
  setTendersHiddenColumns: (hiddenColumns: string[]) => void;
  setTendersColumnOrder: (columnOrder: string[]) => void;
  setProjectsHiddenColumns: (hiddenColumns: string[]) => void;
  setProjectsColumnOrder: (columnOrder: string[]) => void;
  setProjectsColumnWidth: (columnKey: string, width: number) => void;
  setServerStorageHiddenColumns: (hiddenColumns: string[]) => void;
  setServerStorageColumnOrder: (columnOrder: string[]) => void;
  setServerStorageColumnWidth: (columnKey: string, width: number) => void;
  setOrganizationsColumnWidth: (columnKey: string, width: number) => void;
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
      notifications: [],
      toasts: [],
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
      organizationsTable: {
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
      pushToast: ({ type = 'info', message, duration = 8000 }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
        setTimeout(() => useAppStore.getState().dismissToast(id), duration);
      },
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
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
      setOrganizationsColumnWidth: (columnKey, width) =>
        set((s) => ({
          organizationsTable: {
            ...s.organizationsTable,
            columnWidths: {
              ...s.organizationsTable.columnWidths,
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
        organizationsTable: state.organizationsTable,
        tendersView: state.tendersView,
      }),
    }
  )
);
