/** Value in crores from text such as "₹42.80 Cr". */
export function parseCrores(text: string): number {
  return parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
}

/** 182.7239 -> "₹182.72". */
export function formatCrores(value: number): string {
  return `₹${value.toFixed(2)}`;
}
