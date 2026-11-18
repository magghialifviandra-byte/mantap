export function clampStr(val: string, maxLen: number): string {
  return (val || '').trim().slice(0, maxLen);
}

export function clampArray<T>(arr: T[], maxLen: number): T[] {
  return Array.isArray(arr) ? arr.slice(0, maxLen) : [];
}

export function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function sanitizeDateStr(d: string, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback;
}

export function sanitizeWeekKey(w: string, fallback: string): string {
  return /^\d{4}-W\d{2}$/.test(w) ? w : fallback;
}
