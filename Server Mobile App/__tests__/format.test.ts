import { fmtDur, fmtInterval } from '../src/lib/format';

test('fmtDur picks the two largest units', () => {
  expect(fmtDur(38_000)).toBe('38s');
  expect(fmtDur(4 * 60_000 + 12_000)).toBe('4m 12s');
  expect(fmtDur((3 * 86400 + 7 * 3600) * 1000)).toBe('3d 7h');
});

test('fmtInterval reads like a schedule', () => {
  expect(fmtInterval(360)).toBe('every 6h');
  expect(fmtInterval(1440)).toBe('every day');
  expect(fmtInterval(45)).toBe('every 45m');
  expect(fmtInterval(null)).toBe('—');
});

import { fmtDays, fmtEvery, formatIst, nextWholeHour, parseIst } from '../src/lib/format';

test('fmtDays: Everyday, or short initials in week order', () => {
  expect(fmtDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).toBe('Everyday');
  expect(fmtDays([])).toBe('Everyday');
  expect(fmtDays(['sat', 'mon', 'tue', 'wed', 'thu', 'fri'])).toBe('M Tu W Th F Sa');
  expect(fmtDays(['sun', 'sat'])).toBe('Sa Su');
});

test('fmtEvery reads like the card', () => {
  expect(fmtEvery(240)).toBe('Every 4h');
  expect(fmtEvery(1440)).toBe('Every 1 day');
  expect(fmtEvery(2880)).toBe('Every 2 days');
  expect(fmtEvery(0)).toBe('Manual');
});

test('IST text round-trips and the next whole hour is on the hour in IST', () => {
  const secs = parseIst('2026-10-19 10:00')!;
  expect(formatIst(secs)).toBe('2026-10-19 10:00');
  expect(parseIst('2026-13-01 10:00')).toBeNull();
  // 09:12 IST → 10:00 IST
  expect(formatIst(nextWholeHour(parseIst('2026-10-19 09:12')! * 1000))).toBe('2026-10-19 10:00');
});
