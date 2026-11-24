/**
 * Value in crores from text such as "₹42.80 Cr", "₹86.4 L" (lakhs) or a plain rupee
 * amount ("₹9,50,000"). Text without a unit is read as crores, as in the sample data.
 */
export function parseCrores(text: string): number {
  const n = parseFloat(String(text).replace(/[^0-9.]/g, '')) || 0;
  if (/\bL\b|lakh/i.test(text)) return n / 100;
  if (/cr/i.test(text)) return n;
  // A bare rupee amount with grouping commas is in rupees.
  if (/,/.test(text) || n >= 1e5) return n / 1e7;
  return n;
}

/** 182.7239 -> "₹182.72". */
export function formatCrores(value: number): string {
  return `₹${value.toFixed(2)}`;
}

/** "₹42.80 Cr" -> { amount: "₹42.80", unit: "Cr" }; "₹9,50,000" -> no unit. */
export function splitValue(text: string): { amount: string; unit: string } {
  const m = /^(₹?\s*[\d,.]+)\s*(Cr|L)?\b/.exec(String(text).trim());
  if (!m) return { amount: text, unit: '' };
  const amount = m[1].replace(/\s+/g, '');
  return {
    amount: amount.startsWith('₹') ? amount : `₹${amount}`,
    unit: m[2] ?? '',
  };
}
