import type { Tender } from '../fixtures/tenders';
import { publishedKey } from './dates';
import { parseFlexibleDate } from './serverTender';

export type CalendarDay = {
  /** yyyymmdd, comparable with `publishedKey` of a tender's closing date. */
  key: number;
  /** 'Su' … 'Sa' */
  name: string;
  num: number;
  today: boolean;
  /** Tenders closing on this day. */
  count: number;
};

const NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const keyOf = (d: Date) =>
  d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/**
 * The day a tender closes, as yyyymmdd. Live tenders read "26 Oct 2026, 3:00 PM" and the
 * sample data "26-Aug-2024 15:00"; 0 when there is no usable date.
 */
export function closingDayKey(closing: string): number {
  if (!closing || closing === '—') return 0;
  const d = parseFlexibleDate(closing);
  return d ? keyOf(d) : publishedKey(closing);
}

/**
 * Consecutive days grouped in whole Sunday-to-Saturday weeks: `weeksBefore` weeks before
 * the week containing `today`, that week, then `weeksAfter` more.
 */
export function buildCalendar(
  tenders: Tender[],
  today: Date,
  weeksBefore = 2,
  weeksAfter = 3,
): CalendarDay[] {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - weeksBefore * 7,
  );
  const counts = new Map<number, number>();
  tenders.forEach(t => {
    const k = closingDayKey(t.closing);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const total = (weeksBefore + 1 + weeksAfter) * 7;
  const todayKey = keyOf(today);
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    const key = keyOf(d);
    return {
      key,
      name: NAMES[d.getDay()],
      num: d.getDate(),
      today: key === todayKey,
      count: counts.get(key) ?? 0,
    };
  });
}
