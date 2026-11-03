// Parent-teacher meetings (phase 33): small shared helpers for the booking page, the
// teacher app tab, the parent card and Admin → Parent meetings.

// "13:30" → "1:30 PM"
export function ampm(hm: string | null | undefined): string {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "2026-11-18" → "Wednesday, November 18, 2026"
export function longDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export const KIND_LABEL: Record<string, string> = { class: "Class teacher", quran: "Qur'an teacher" };

export interface Remark { body: string; by: string | null; at: string }

// a one-event .ics as a data: link, so parents can add the meeting to their phone calendar
export function icsFile(ev: { title: string; class: string; date: string; minutes: number }, hm: string, who: string): string {
  const d = ev.date.replace(/-/g, "");
  const [h, m] = hm.split(":").map(Number);
  const end = h * 60 + m + ev.minutes;
  const t = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}${String(x % 60).padStart(2, "0")}00`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Falah Academy//Parent meetings//EN", "BEGIN:VEVENT",
    `UID:ptm-${d}-${t(h * 60 + m)}-${Math.random().toString(36).slice(2)}@falahacademywa.org`,
    `DTSTART;TZID=America/Los_Angeles:${d}T${t(h * 60 + m)}`, `DTEND;TZID=America/Los_Angeles:${d}T${t(end)}`,
    `SUMMARY:${ev.title} (${ev.class}) - ${who}`,
    "LOCATION:Falah Academy, 25650 101st Ave SE, Kent, WA 98030",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
}
