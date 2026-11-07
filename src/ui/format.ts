const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month 0 is January of year 1. */
export function formatDate(month: number): string {
  return `${MONTHS[month % 12]} year ${Math.floor(month / 12) + 1}`;
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return Math.round(n).toString();
}

export function formatNumber(v: number, digits: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
