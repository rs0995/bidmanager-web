import type { AlertItem, AlertKind } from '../fixtures/alerts';

// Pure helpers for the bidwise Alerts tab: Today / Earlier grouping and per-kind titles.

export const ALERT_TITLES: Record<AlertKind, string> = {
  deadline: 'Closing soon',
  change: 'Tender updated',
  new: 'New tenders',
  success: 'Checklist complete',
  prep: 'Documents pending',
  download: 'Download finished',
  project: 'New project',
};

/** "22 min ago", "Updated 4 min ago", "2 hours ago" are today; anything else is earlier. */
export const isToday = (time: string) =>
  /\b(min|mins|hour|hours|h) ago\b/.test(time);

export type AlertGroup = { name: 'Today' | 'Earlier'; items: AlertItem[] };

export function groupAlerts(
  alerts: AlertItem[],
  unreadOnly: boolean,
): AlertGroup[] {
  const shown = alerts.filter(a => !unreadOnly || a.unread);
  return (['Today', 'Earlier'] as const)
    .map(name => ({
      name,
      items: shown.filter(a => isToday(a.time) === (name === 'Today')),
    }))
    .filter(g => g.items.length > 0);
}
