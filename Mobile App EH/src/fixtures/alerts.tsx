import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Phase 1 only: in-memory alerts. Replaced by lib/alerts.ts (persisted, filled by the
// update check and local deadline reminders) in Phase 2D/2E.

export type AlertKind = 'deadline' | 'change' | 'new' | 'success';

export type AlertItem = {
  id: string;
  kind: AlertKind;
  message: string;
  time: string;
  unread: boolean;
  /** Opens this tender when tapped. */
  tenderId?: string;
  /** Opens this project when tapped. */
  projectId?: string;
  /** "New tenders" alerts: the tenders that arrived, listed on the New tenders screen. */
  newTenderIds?: string[];
  orgName?: string;
};

const seed: AlertItem[] = [
  {
    id: 'a1',
    kind: 'deadline',
    message:
      'CPWD Nagpur staff quarters closes in 6 hours — 2 checklist items still pending.',
    time: '22 min ago',
    unread: true,
    tenderId: 'eProc/CPWD/2024/2211',
  },
  {
    id: 'a2',
    kind: 'change',
    message:
      'Corrigendum I appeared for Panvel–Uran road (PWD Konkan). Completion period revised to 18 months; EMD unchanged.',
    time: 'Updated 4 min ago',
    unread: true,
    tenderId: '2024_PWD_1043567_1',
  },
  {
    id: 'a3',
    kind: 'new',
    message:
      'The latest update added 2 new tenders under Municipal Corp. of Greater Mumbai.',
    time: 'Updated 4 min ago',
    unread: true,
    orgName: 'Municipal Corp. of Greater Mumbai',
    newTenderIds: ['MCGM/RD/2024/1601', 'MCGM/SWD/2024/1567'],
  },
  {
    id: 'a4',
    kind: 'deadline',
    message:
      'MCGM K-West drains — pre-bid meeting tomorrow 23-Aug, 3:30 PM, SWD office, Byculla.',
    time: 'Yesterday',
    unread: false,
    tenderId: 'MCGM/SWD/2024/1567',
  },
  {
    id: 'a5',
    kind: 'change',
    message:
      'Closing date for MSRDC Expressway renewal moved from 03-Sep to 05-Sep.',
    time: '22-Aug',
    unread: false,
    tenderId: 'MSRDC/EE/2024/0899',
  },
  {
    id: 'a6',
    kind: 'success',
    message: 'Project RII-2024-027 checklist reached 100% ready.',
    time: 'Yesterday',
    unread: false,
    projectId: 'RII-2024-027',
  },
];

type Ctx = {
  alerts: AlertItem[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remindersOn: boolean;
  setRemindersOn: (on: boolean) => void;
};

const AlertsContext = createContext<Ctx>({
  alerts: [],
  unread: 0,
  markRead: () => {},
  markAllRead: () => {},
  remindersOn: true,
  setRemindersOn: () => {},
});

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<AlertItem[]>(seed);
  const [remindersOn, setRemindersOn] = useState(true);

  const markRead = useCallback((id: string) => {
    setAlerts(prev =>
      prev.map(a => (a.id === id ? { ...a, unread: false } : a)),
    );
  }, []);
  const markAllRead = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, unread: false })));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      alerts,
      unread: alerts.filter(a => a.unread).length,
      markRead,
      markAllRead,
      remindersOn,
      setRemindersOn,
    }),
    [alerts, markRead, markAllRead, remindersOn],
  );

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
}

export const useAlerts = () => useContext(AlertsContext);
