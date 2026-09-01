// Local-time date strings. The school runs on Pacific time; UTC flips to the
// next day around 4-5pm local, which made fees show as due the evening before
// the 1st. Always derive "today" from the local clock.
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthStr(): string {
  return todayStr().slice(0, 7);
}
