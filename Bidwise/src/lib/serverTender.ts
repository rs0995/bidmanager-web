import type { ServerTender } from './api';
import type { Tender, Urgency } from '../fixtures/tenders';

// Turns a server tender (client_api.py _public_tender) into the Tender shape every
// Bidwise screen and the EH dashboard already use, so live data drops in behind the
// same components. Date parsing is ported from BM Pro's lib/format.js.

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * A pre-bid meeting's time (ms), only when the text has a time of day: a bare date
 * can't be reminded on time, so the server skips those and so does the switch.
 */
export function prebidTime(text: string | null | undefined): number | null {
  if (!text || !/\d{1,2}:\d{2}/.test(text)) return null;
  const d = parseFlexibleDate(text);
  return d ? d.getTime() : null;
}

/**
 * ISO-8601, or portal text such as "08-Sep-2026 03:00 PM". The month lookup is spelled
 * out because Hermes can't parse "Oct 1, 2000" (BM Pro hit this: deadlines came up
 * empty on the phone while working on the web).
 */
export function parseFlexibleDate(
  dateLike: string | null | undefined,
): Date | null {
  if (!dateLike) return null;
  const text = String(dateLike).trim();
  // "2026-10-25 15:00": Hermes rejects the space, so read it as local time.
  const spaced = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (spaced) {
    const [, y, mo, d, h, mi, se = '0'] = spaced;
    return new Date(+y, +mo - 1, +d, +h, +mi, +se);
  }
  // "25/10/2026" or "25-10-2026 3:00 PM": Indian day-first dates, which
  // new Date() would read month-first (or not at all).
  const dayFirst = text.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?$/i,
  );
  if (dayFirst) {
    const [, d, mo, y, hour = '0', mi = '0', ap] = dayFirst;
    let h = Number(hour);
    if (ap && /pm/i.test(ap) && h < 12) h += 12;
    if (ap && /am/i.test(ap) && h === 12) h = 0;
    const out = new Date(+y, +mo - 1, +d, h, +mi);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const direct = new Date(dateLike);
  if (!Number.isNaN(direct.getTime())) return direct;
  const m = String(dateLike).match(
    /(\d{1,2})[-\s](\w{3,})[-\s](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
  );
  if (!m) return null;
  const [, day, mon, year, hour = '0', min = '0', ampm] = m;
  const month = MONTH_INDEX[mon.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  let h = Number(hour);
  if (ampm && /pm/i.test(ampm) && h < 12) h += 12;
  if (ampm && /am/i.test(ampm) && h === 12) h = 0;
  const d = new Date(Number(year), month, Number(day), h, Number(min));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "₹42.80 Cr", "₹86.4 L", "₹9,50,000" from the server's free-text amount. */
export function fmtINR(value: string | number | null | undefined): string {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, '')) || 0;
  if (!n) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/** "08 Sep 2026, 3:00 pm"; the date alone when no time was given. */
export function formatDateTime(dateLike: string | null | undefined): string {
  if (!dateLike) return '—';
  const d = parseFlexibleDate(dateLike);
  if (!d) return String(dateLike);
  const day = `${String(d.getDate()).padStart(2, '0')} ${Object.keys(
    MONTH_INDEX,
  )[d.getMonth()].replace(/^./, c => c.toUpperCase())} ${d.getFullYear()}`;
  if (d.getHours() === 0 && d.getMinutes() === 0) return day;
  const h12 = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${day}, ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

/**
 * Countdown text in the dashboard's format ("6h", "2d 4h", "8d") and its urgency:
 * Critical under a day, Soon within 5 days, otherwise ok. Past deadlines read "Closed".
 */
export function countdown(
  closesAt: Date | null,
  now = Date.now(),
): { closeIn: string; state: Urgency } {
  if (!closesAt) return { closeIn: '—', state: 'ok' };
  const hours = Math.floor((closesAt.getTime() - now) / 3_600_000);
  if (hours < 0) return { closeIn: 'Closed', state: 'crit' };
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  const closeIn =
    days === 0
      ? `${hours}h`
      : days < 3 && rem
      ? `${days}d ${rem}h`
      : `${days}d`;
  const state: Urgency = hours < 24 ? 'crit' : days <= 5 ? 'soon' : 'ok';
  return { closeIn, state };
}

/** Short card title: the first clause of a long tender title. */
export function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= 56) return clean;
  const cut = clean.slice(0, 56);
  return `${cut.slice(
    0,
    cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 56,
  )}…`;
}

export function toTender(s: ServerTender, now = Date.now()): Tender {
  const closesAt = parseFlexibleDate(s.closing_date);
  const { closeIn, state } = countdown(closesAt, now);
  const title =
    s.title || s.work_description || s.tender_id || 'Untitled tender';
  return {
    id: String(s.id),
    short: shortTitle(title),
    portal: s.website_name || 'Portal',
    org: s.organization || s.website_name || '',
    title,
    value: fmtINR(s.tender_value),
    emd: fmtINR(s.emd),
    category: s.category || '—',
    location: s.location || '—',
    published: formatDateTime(s.published_date),
    closing: formatDateTime(s.closing_date),
    closeIn,
    state,
    prebid: s.pre_bid_meeting_date
      ? formatDateTime(s.pre_bid_meeting_date)
      : '—',
    prebidAt: prebidTime(s.pre_bid_meeting_date),
    docs: [],
    refId: s.tender_id,
    url: s.tender_url || s.website_url,
    closesAt: closesAt ? closesAt.getTime() : null,
    docCount: s.document_count,
    corrigenda: s.corrigendum_count,
    archived: s.is_archived,
    description: s.work_description,
    opening: s.opening_date ? formatDateTime(s.opening_date) : undefined,
  };
}
