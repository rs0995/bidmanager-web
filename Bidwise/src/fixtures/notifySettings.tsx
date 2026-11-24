import React, { createContext, useContext, useMemo, useState } from 'react';

// Demo mode: push notification preferences and pre-bid switches in memory. Live mode
// (live/LiveProviders.tsx) stores them and pushes them to the server (schedulePush).

/** Closing-reminder thresholds offered, in days before close. */
export const DAY_THRESHOLDS = [1, 2, 3, 5] as const;

/** Pre-bid reminder times offered, in minutes before the meeting. */
export const PREBID_LEAD_OPTIONS = [1440, 240, 120, 60] as const;

export type NotifySettings = {
  orgAlerts: boolean;
  tenderAlerts: boolean;
  reminderDays: number[];
  /** In-app alert when someone else adds a project (this phone only). */
  projectAlerts: boolean;
  /** Pre-bid reminder times, minutes before the meeting. */
  prebidLeads: number[];
  /** Pre-bid reminders on for every bookmarked tender unless switched off. */
  prebidAutoBookmarked: boolean;
};

export type NotifyCtx = {
  settings: NotifySettings;
  set: (patch: Partial<NotifySettings>) => void;
  toggleDay: (day: number, on: boolean) => void;
  togglePrebidLead: (minutes: number, on: boolean) => void;
  /**
   * Whether a tender's pre-bid reminder is on (by hand, or auto for bookmarks).
   * `tenderRef` is the portal tender ID, the only tender identity.
   */
  prebidOn: (tenderRef: string, bookmarked: boolean) => boolean;
  /** Switches one tender's pre-bid reminder (shared with the organisation). */
  setPrebid: (tenderRef: string, on: boolean) => void;
};

const DEMO_SETTINGS: NotifySettings = {
  orgAlerts: true,
  tenderAlerts: true,
  reminderDays: [1, 3],
  projectAlerts: true,
  prebidLeads: [1440, 120],
  prebidAutoBookmarked: false,
};

/** Adds or removes one value, keeping the list sorted (largest first when `desc`). */
export function toggleIn(
  list: number[],
  value: number,
  on: boolean,
  desc = false,
) {
  const next = on
    ? [...new Set([...list, value])]
    : list.filter(v => v !== value);
  return next.sort((a, b) => (desc ? b - a : a - b));
}

export const NotifyContext = createContext<NotifyCtx>({
  settings: DEMO_SETTINGS,
  set: () => {},
  toggleDay: () => {},
  togglePrebidLead: () => {},
  prebidOn: () => false,
  setPrebid: () => {},
});

export function NotifySettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<NotifySettings>(DEMO_SETTINGS);
  const [prebid, setPrebidMap] = useState<Record<string, boolean>>({});
  const value = useMemo<NotifyCtx>(
    () => ({
      settings,
      set: patch => setSettings(s => ({ ...s, ...patch })),
      toggleDay: (day, on) =>
        setSettings(s => ({
          ...s,
          reminderDays: toggleIn(s.reminderDays, day, on),
        })),
      togglePrebidLead: (minutes, on) =>
        setSettings(s => ({
          ...s,
          prebidLeads: toggleIn(s.prebidLeads, minutes, on, true),
        })),
      prebidOn: (id, bookmarked) =>
        prebid[id] ?? (settings.prebidAutoBookmarked && bookmarked),
      setPrebid: (id, on) => setPrebidMap(m => ({ ...m, [id]: on })),
    }),
    [settings, prebid],
  );
  return (
    <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>
  );
}

export const useNotifySettings = () => useContext(NotifyContext);
