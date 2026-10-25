import { buildCalendar } from '../src/lib/calendar';
import { tenders } from '../src/fixtures/tenders';

const today = new Date(2024, 7, 27); // Tue 27-Aug-2024

describe('buildCalendar', () => {
  const days = buildCalendar(tenders, today);
  const at = (num: number, name?: string) =>
    days.find(d => d.num === num && (!name || d.name === name))!;

  it('lays out whole Sunday-to-Saturday weeks around today', () => {
    expect(days).toHaveLength(42);
    expect(days.length % 7).toBe(0);
    expect(days[0].name).toBe('Su');
    expect(days[6].name).toBe('Sa');
    const t = days.filter(d => d.today);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ num: 27, name: 'Tu' });
    // Today's week is the third page (two weeks before it).
    expect(Math.floor(days.findIndex(d => d.today) / 7)).toBe(2);
  });

  it('counts the tenders closing on each day', () => {
    expect(at(26, 'Mo').count).toBe(1); // Panvel–Uran road widening
    expect(at(27).count).toBe(0);
    expect(at(5, 'Th').count).toBe(2); // two tenders close on 05-Sep
    expect(at(28).count).toBe(1);
  });
});

describe('live closing dates', () => {
  it('counts the server’s "26 Oct 2026, 3:00 PM" format too', () => {
    const live = [
      { ...tenders[0], id: 'x', closing: '26 Oct 2026, 3:00 PM' },
      { ...tenders[0], id: 'y', closing: '26 Oct 2026' },
      { ...tenders[0], id: 'z', closing: '—' },
    ];
    const days = buildCalendar(live, new Date(2026, 9, 24));
    expect(days.find(d => d.key === 20261026)?.count).toBe(2);
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(2);
  });
});
