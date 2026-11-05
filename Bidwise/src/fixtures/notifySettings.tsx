import React, { createContext, useContext, useMemo, useState } from 'react';

// Phase 1 only: push notification preferences in memory. Phase 2 stores them with the
// rest of the settings and pushes them to the server (schedulePush), as BM Pro does.

/** Closing-reminder thresholds offered, in days before close. */
export const DAY_THRESHOLDS = [1, 2, 3, 5] as const;

export type NotifySettings = {
  orgAlerts: boolean;
  tenderAlerts: boolean;
  reminderDays: number[];
  /** In-app alert when someone else adds a project (this phone only). */
  projectAlerts: boolean;
};

export type NotifyCtx = {
  settings: NotifySettings;
  set: (patch: Partial<NotifySettings>) => void;
  toggleDay: (day: number, on: boolean) => void;
};

export const NotifyContext = createContext<NotifyCtx>({
  settings: {
    orgAlerts: true,
    tenderAlerts: true,
    reminderDays: [1, 3],
    projectAlerts: true,
  },
  set: () => {},
  toggleDay: () => {},
});

export function NotifySettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<NotifySettings>({
    orgAlerts: true,
    tenderAlerts: true,
    reminderDays: [1, 3],
    projectAlerts: true,
  });
  const value = useMemo<NotifyCtx>(
    () => ({
      settings,
      set: patch => setSettings(s => ({ ...s, ...patch })),
      toggleDay: (day, on) =>
        setSettings(s => ({
          ...s,
          reminderDays: on
            ? [...new Set([...s.reminderDays, day])].sort((a, b) => a - b)
            : s.reminderDays.filter(d => d !== day),
        })),
    }),
    [settings],
  );
  return (
    <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>
  );
}

export const useNotifySettings = () => useContext(NotifyContext);
