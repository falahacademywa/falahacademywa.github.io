// US display formats for the admin/parent UI. Storage stays ISO (YYYY-MM-DD)
// and raw phone text; these are presentation only.

/** "2023-07-02" -> "07/02/2023". Anything unparseable is returned as-is. */
export function usDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** "2068290931" / "206-829-0931" / "+1 206 829 0931" -> "(206) 829-0931".
 *  Numbers that aren't 10 (or 11 starting with 1) digits are returned as typed. */
export function usPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return raw;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Whole years between an ISO date of birth and today. */
export function ageYears(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const b = new Date(iso + "T12:00:00"), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
