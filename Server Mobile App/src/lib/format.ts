// Display formatting shared by every screen. Times are shown in IST, like Server UI.

const IST = 'Asia/Kolkata';

/** 3d 7h · 4m 12s · 38s */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** 14 Oct, 09:30 */
export function fmtDateTime(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 09:30:12 */
export function fmtClock(value: string | number): string {
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** 5m ago · 3h ago · 2d ago · never */
export function fmtAgo(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'never';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'just now';
  return `${fmtDur(diff).split(' ')[0]} ago`;
}

/** 360 → every 6h · 1440 → every day */
export function fmtInterval(minutes: number | null): string {
  if (!minutes) return '—';
  if (minutes % 1440 === 0)
    return minutes === 1440 ? 'every day' : `every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
}

/** Server snake_case timestamps are epoch seconds; 0 / null mean "none". */
export const fromSecs = (s: number | null | undefined) =>
  s ? s * 1000 : null;

export const fmtNumber = (n: number) => n.toLocaleString('en-IN');

export const pad2 = (n: number) => String(n).padStart(2, '0');

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_SHORT: Record<string, string> = {
  mon: 'M',
  tue: 'Tu',
  wed: 'W',
  thu: 'Th',
  fri: 'F',
  sat: 'Sa',
  sun: 'Su',
};

/** ['mon','tue'…] → "Everyday" for all seven, else "M Tu W Th F Sa" in week order. */
export function fmtDays(days: string[] | null | undefined): string {
  const set = new Set((days ?? []).map(d => d.trim().toLowerCase().slice(0, 3)));
  const picked = WEEK.filter(d => set.has(d));
  if (picked.length === 0 || picked.length === 7) return 'Everyday';
  return picked.map(d => DAY_SHORT[d]).join(' ');
}

/** 240 → "Every 4h" · 1440 → "Every 1 day" · 2880 → "Every 2 days" · 45 → "Every 45m". */
export function fmtEvery(minutes: number | null | undefined): string {
  const m = Number(minutes) || 0;
  if (!m) return 'Manual';
  if (m % 1440 === 0) return `Every ${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `Every ${m / 60}h`;
  return `Every ${m}m`;
}

/** 19 Oct 10:00 (IST), compact for cards. */
export function fmtShortDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return fmtDateTime(ms).replace(',', '');
}

// Scheduling uses IST wall-clock text, "2026-10-15 09:30", like the desktop's
// date-time field, so it's independent of the phone's own time zone.
const IST_OFFSET_MS = 330 * 60_000;

/** "2026-10-15 09:30" (IST) → epoch seconds, or null if it doesn't parse. */
export function parseIst(text: string): number | null {
  const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
  return Number.isFinite(utc) ? Math.floor(utc / 1000) : null;
}

/** epoch seconds → "2026-10-15 09:30" in IST ('' for 0). */
export function formatIst(secs: number): string {
  if (!secs) return '';
  const d = new Date(secs * 1000 + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}`;
}

/** The next whole hour in IST (IST is UTC+5:30, so not a UTC whole hour), as epoch seconds. */
export function nextWholeHour(nowMs = Date.now()): number {
  const hour = 3_600_000;
  const ist = nowMs + IST_OFFSET_MS;
  return (Math.floor(ist / hour) + 1) * 3600 - IST_OFFSET_MS / 1000;
}
