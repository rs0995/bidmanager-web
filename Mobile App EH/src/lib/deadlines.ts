import type { Tender, Urgency } from '../fixtures/tenders';

// Pure deadline helpers for the Dashboard. The countdown text ("2d 4h", "6h", "13d")
// comes from the tender; Phase 2 swaps it for a real closing date without changing callers.

/** Hours until close, read from the countdown text. */
export function hoursUntilClose(closeIn: string): number {
  const d = /(\d+)\s*d/.exec(closeIn);
  const h = /(\d+)\s*h/.exec(closeIn);
  return (d ? parseInt(d[1], 10) * 24 : 0) + (h ? parseInt(h[1], 10) : 0);
}

/** "2d 4h" -> "2d left", "6h" -> "6h left". */
export function leftLabel(closeIn: string): string {
  return `${closeIn.split(' ')[0]} left`;
}

export type UpcomingGroup = {
  urgency: Urgency;
  label: string;
  items: Tender[];
};

const LABELS: Record<Urgency, string> = {
  crit: 'CRITICAL',
  soon: 'SOON',
  ok: 'LATER',
};

/** Soonest-closing tenders, grouped Critical / Soon / Later (empty groups omitted). */
export function groupUpcoming(all: Tender[], limit = 8): UpcomingGroup[] {
  const sorted = [...all]
    .sort((a, b) => hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn))
    .slice(0, limit);
  return (['crit', 'soon', 'ok'] as Urgency[])
    .map(urgency => ({
      urgency,
      label: LABELS[urgency],
      items: sorted.filter(t => t.state === urgency),
    }))
    .filter(g => g.items.length > 0);
}
