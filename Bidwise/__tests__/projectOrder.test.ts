import { sortProjectsByClosing } from '../src/lib/projectOrder';

// Project cards: soonest closing first; closed more than 3 hours ago at the bottom.

const H = 3_600_000;
const now = Date.UTC(2026, 9, 26, 12);

it('puts open ones soonest first, recent closings on top and old ones last', () => {
  const at: Record<string, number | null> = {
    inTwoDays: now + 48 * H,
    tomorrow: now + 20 * H,
    closedAnHourAgo: now - 1 * H,
    noDate: null,
    closedFiveHoursAgo: now - 5 * H,
    closedLastWeek: now - 7 * 24 * H,
  };
  const order = sortProjectsByClosing(
    [
      'closedLastWeek',
      'inTwoDays',
      'noDate',
      'closedFiveHoursAgo',
      'tomorrow',
      'closedAnHourAgo',
    ],
    p => at[p],
    now,
  );
  expect(order).toEqual([
    'closedAnHourAgo',
    'tomorrow',
    'inTwoDays',
    'noDate',
    'closedFiveHoursAgo',
    'closedLastWeek',
  ]);
});
