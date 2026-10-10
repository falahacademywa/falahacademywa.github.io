// Local-time date strings. The school runs on Pacific time; UTC flips to the
// next day around 4-5pm local, which made fees show as due the evening before
// the 1st. Always derive "today" from the local clock.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayStr(): string {
  return ymd(new Date());
}

export function monthStr(): string {
  return todayStr().slice(0, 7);
}

// Local calendar date of a stored UTC timestamp (created_at etc.). Never use
// timestamp.slice(0, 10): that is the UTC date, a day ahead in the evening.
export function localDateStr(ts: string): string {
  return ymd(new Date(ts));
}
