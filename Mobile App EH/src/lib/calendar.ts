import type { Tender } from '../fixtures/tenders';
import { publishedKey } from './dates';

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
    const k = publishedKey(t.closing);
    counts.set(k, (counts.get(k) ?? 0) + 1);
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
