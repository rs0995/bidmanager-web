const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** Parses '19-Aug-2024' (optionally followed by a time) into a sortable number. */
export function publishedKey(text: string): number {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(text.trim());
  if (!m) return 0;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return 0;
  return Number(m[3]) * 10000 + (month + 1) * 100 + Number(m[1]);
}
