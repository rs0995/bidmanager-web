import { timeRemaining } from "./format.js";

// "Needs attention" = bookmarked tenders still open that show "1d left" or
// "Today" (the same calendar-day count the rest of the app displays), soonest
// first. The exact-time check drops ones whose closing time already passed.
export function getClosingSoon(tenders, now = Date.now()) {
  return (tenders || [])
    .map((tender) => {
      const { date, totalDays, label } = timeRemaining(tender.closing_date);
      if (!date || totalDays == null || totalDays < 0 || totalDays > 1) return null;
      const msLeft = date.getTime() - now;
      return msLeft > 0 ? { tender, msLeft, label } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.msLeft - b.msLeft);
}
