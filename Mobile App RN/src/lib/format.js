export function parseINR(value) {
  return Number(String(value ?? "").replace(/[^0-9.]/g, "")) || 0;
}

export function fmtINR(n) {
  const value = parseINR(n);
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

export const formatCrores = fmtINR;

export function timeRemaining(dateLike) {
  if (!dateLike) return { totalDays: null, expired: false, label: "—" };
  let date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    const match = String(dateLike).match(
      /(\d{1,2})[-\s](\w{3,})[-\s](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
    );
    if (match) {
      const [, day, mon, year, hour = "0", min = "0", ampm] = match;
      const monthIndex = new Date(`${mon} 1, 2000`).getMonth();
      let h = Number(hour);
      if (ampm && /pm/i.test(ampm) && h < 12) h += 12;
      if (ampm && /am/i.test(ampm) && h === 12) h = 0;
      date = new Date(Number(year), monthIndex, Number(day), h, Number(min));
    }
  }
  if (Number.isNaN(date.getTime())) return { totalDays: null, expired: false, label: "—" };
  const diffMs = date.getTime() - Date.now();
  const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const expired = diffMs < 0;
  const label = expired ? "Closed" : totalDays <= 0 ? "Today" : `${totalDays}d left`;
  return { totalDays, expired, label, date };
}

export function urgency(totalDays) {
  if (totalDays == null) return { key: "unknown", label: "—", color: "var(--text-muted)" };
  if (totalDays <= 3) return { key: "crit", label: "Critical", color: "var(--danger)" };
  if (totalDays <= 7) return { key: "soon", label: "Soon", color: "var(--warn)" };
  return { key: "ok", label: "Comfortable", color: "var(--ok)" };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(dateLike) {
  if (!dateLike) return "—";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return String(dateLike);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const IST_TZ = "Asia/Kolkata";

function istNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour };
}

export function formatDateTimeIST(dateLike) {
  if (!dateLike) return "—";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return String(dateLike);
  return date.toLocaleString("en-IN", { timeZone: IST_TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function scrapeCooldownMessage(lastScrapedAtEpochSeconds) {
  const { year, month, day, hour } = istNowParts();
  if (hour < 20) return "Next update will be available at 8:00 PM IST.";
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const tomorrowLabel = tomorrow.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
  return `Last updated on ${formatDateTimeIST(lastScrapedAtEpochSeconds * 1000)}. Next update will be available ${tomorrowLabel} 8:00 PM IST.`;
}
