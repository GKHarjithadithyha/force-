/**
 * Local-day rules for daily summaries. They match the dashboard (fedfront/lib/analytics.ts
 * `startOfLocalDay`): a day starts at local midnight of the computer that holds the data, and the
 * next day starts at the next local midnight (23 or 25 hours long across a DST change).
 * The time zone used is stored with every daily summary, so the bounds can always be checked.
 */

export interface LocalDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Epoch ms of local midnight (inclusive). */
  startMs: number;
  /** Epoch ms of the next local midnight (exclusive). */
  endMs: number;
}

export function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function nextLocalDay(dayStartMs: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDay(ms: number): LocalDay {
  const startMs = localDayStart(ms);
  return { date: localDateKey(startMs), startMs, endMs: nextLocalDay(startMs) };
}

/** Every local day touched by [fromMs, toMs] (both ends inclusive), oldest first. */
export function localDaysSpanned(fromMs: number, toMs: number): LocalDay[] {
  const out: LocalDay[] = [];
  let day = localDay(fromMs);
  const last = Math.max(fromMs, toMs);
  // guard: a broken end time must not loop for years
  for (let i = 0; i < 400; i++) {
    out.push(day);
    if (day.endMs > last) break;
    day = localDay(day.endMs);
  }
  return out;
}

/** IANA zone name of this computer, e.g. "Asia/Kolkata"; "UTC" if the runtime cannot say. */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
