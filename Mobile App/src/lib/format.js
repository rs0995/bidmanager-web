export function fmtINR(n) {
  const value = Number(n) || 0;
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
  const diffMs = date.getTime() - Date.now();
  const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const expired = diffMs < 0;
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
