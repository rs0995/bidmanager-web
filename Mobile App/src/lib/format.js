// tender_value/emd/project_value come from the backend as raw scraped text
// (e.g. "₹ 4,28,00,000", "Rs. 42,80,00,000", or "" when unscraped) — never a
// clean number. Strip everything but digits/dot before parsing, same as the
// desktop Client UI's valueNumber()/parseFloat(...replace(/[₹,\s]/g,'')).
export function parseINR(value) {
  return Number(String(value ?? '').replace(/[^0-9.]/g, '')) || 0;
}

export function fmtINR(n) {
  const value = parseINR(n);
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

export const formatCrores = fmtINR;

// Parses the date formats the backend actually returns (mostly ISO-8601,
// occasionally "dd-MMM-yyyy hh:mm AM/PM" style tender-portal text) and
// returns days/hours remaining until it, or null if unparseable/blank.
export function timeRemaining(dateLike) {
  if (!dateLike) return { totalDays: null, expired: false, label: '—' };
  let date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    // Fallback for "DD-Mon-YYYY hh:mm AM/PM" style strings.
    const match = String(dateLike).match(
      /(\d{1,2})[-\s](\w{3,})[-\s](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
    );
    if (match) {
      const [, day, mon, year, hour = '0', min = '0', ampm] = match;
      const monthIndex = new Date(`${mon} 1, 2000`).getMonth();
      let h = Number(hour);
      if (ampm && /pm/i.test(ampm) && h < 12) h += 12;
      if (ampm && /am/i.test(ampm) && h === 12) h = 0;
      date = new Date(Number(year), monthIndex, Number(day), h, Number(min));
    }
  }
  if (Number.isNaN(date.getTime())) return { totalDays: null, expired: false, label: '—' };
  // Calendar-date difference (midnight to midnight), not a raw millisecond/hour
  // diff — a closing date should read the same "Xd left" all day regardless of
  // what time it currently is, and only become "Closed" once its calendar date
  // has actually passed.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfClosing = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const totalDays = Math.round((startOfClosing - startOfToday) / (1000 * 60 * 60 * 24));
  const expired = totalDays < 0;
  const label = expired ? 'Closed' : totalDays <= 0 ? 'Today' : `${totalDays}d left`;
  return { totalDays, expired, label, date };
}

// key/label naming matches the reference artifact's chip states (ok/soon/crit).
export function urgency(totalDays) {
  if (totalDays == null) return { key: 'unknown', label: '—', color: 'var(--text-muted)' };
  if (totalDays <= 3) return { key: 'crit', label: 'Critical', color: 'var(--danger)' };
  if (totalDays <= 7) return { key: 'soon', label: 'Soon', color: 'var(--warn)' };
  return { key: 'ok', label: 'Comfortable', color: 'var(--ok)' };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(dateLike) {
  if (!dateLike) return '—';
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return String(dateLike);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The recurring org/tender scrape schedule is a fixed IST time, so this
// needs an explicit timeZone rather than the viewer's local one (unlike
// formatDate's date-only labels, where the day itself rarely differs).
const IST_TZ = 'Asia/Kolkata';

function istNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour };
}

export function formatDateTimeIST(dateLike) {
  if (!dateLike) return '—';
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return String(dateLike);
  return date.toLocaleString('en-IN', { timeZone: IST_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Org/tender scrapes refresh once daily at 8 PM IST. `lastScrapedAtEpochSeconds`
// is the org's `last_scraped_at` field from /client/organizations (epoch
// seconds, 0/falsy meaning never scraped).
export function scrapeCooldownMessage(lastScrapedAtEpochSeconds) {
  const { year, month, day, hour } = istNowParts();
  if (hour < 20) return 'Next update will be available at 8:00 PM IST.';
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const tomorrowLabel = tomorrow.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  return `Last updated on ${formatDateTimeIST(lastScrapedAtEpochSeconds * 1000)}. Next update will be available ${tomorrowLabel} 8:00 PM IST.`;
}
