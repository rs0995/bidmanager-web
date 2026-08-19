import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface TimeInfo {
  text: string;
  urgent: boolean;
  expired: boolean;
  totalDays: number;
}

export function timeRemaining(dateStr: string | null | undefined): TimeInfo {
  const nil: TimeInfo = { text: '-', urgent: false, expired: false, totalDays: -1 };
  if (!dateStr || dateStr === 'N/A') return nil;

  const formats = [
    /(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    /(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/,
  ];

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  let dt: Date | null = null;

  for (const re of formats) {
    const m = dateStr.match(re);
    if (!m) continue;
    const day = parseInt(m[1]);
    const monthRaw = m[2];
    const month = months[monthRaw.toLowerCase()] ?? parseInt(monthRaw) - 1;
    const year = parseInt(m[3]);
    let h = parseInt(m[4]);
    const min = parseInt(m[5]);
    const ap = m[6]?.toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    dt = new Date(year, month, day, h, min);
    break;
  }

  if (!dt) return nil;

  const diff = dt.getTime() - Date.now();
  if (diff <= 0) return { text: 'Expired', urgent: false, expired: true, totalDays: 0 };

  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  if (days > 0) return { text: `${days}d ${hrs}h`, urgent: days <= 3, expired: false, totalDays: days };
  if (hrs > 0) return { text: `${hrs}h ${mins}m`, urgent: true, expired: false, totalDays: 0 };
  return { text: `${mins}m`, urgent: true, expired: false, totalDays: 0 };
}

export function formatINR(val: string | null | undefined): string {
  if (!val || val === 'N/A' || val === '-') return val || '-';
  const original = String(val).trim();
  const stripped = original.replace(/[??,\s]/g, '').replace(/Rs\.?/i, '').replace(/INR/i, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) return original;

  const [intPart, decPart] = stripped.split('.');
  let grouped = intPart;
  if (intPart.length > 3) {
    let tail = intPart.slice(-3);
    let head = intPart.slice(0, -3);
    while (head.length > 2) {
      tail = `${head.slice(-2)},${tail}`;
      head = head.slice(0, -2);
    }
    grouped = `${head},${tail}`.replace(/^,/, '');
  }
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

export function formatCrores(val: number): string {
  if (val <= 0) return '0';
  const cr = val / 10000000;
  if (cr >= 100) return `${Math.round(cr).toLocaleString()} Cr`;
  if (cr >= 1) return `${cr.toFixed(1)} Cr`;
  const lakh = val / 100000;
  if (lakh >= 1) return `${lakh.toFixed(1)} L`;
  return `${val.toLocaleString()}`;
}
