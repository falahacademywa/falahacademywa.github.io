// Social post queue (phase 36, TODO #110): shared helpers for Admin → Social posts and the
// Announcements tick box. Cards are drawn in the browser (text, logo, shapes only: never a photo
// of a child, President's strict rule 2026-11-05) and uploaded to the public 'social' bucket so
// Instagram can fetch them.
import { supabase } from "./supabase";

export interface SocialTemplate {
  key: string; category: string; name: string; body: string; card_headline: string; card_sub: string;
  card_style: CardStyle; manual: boolean; active: boolean; sort: number; updated_at: string;
}
export type CardStyle = "navy" | "gold" | "amber" | "calm";
export type PostStatus = "draft" | "needs_date" | "scheduled" | "posting" | "posted" | "failed" | "skipped";
export interface SocialPost {
  id: number; category: string; template_key: string | null; title: string; body: string;
  card_headline: string; card_sub: string; card_style: CardStyle; card_url: string | null;
  image_url: string | null; image_no_children: boolean; platforms: string[]; status: PostStatus;
  manual: boolean; scheduled_at: string | null; source: string; source_ref: string | null;
  fb_post_id: string | null; ig_media_id: string | null; ig_permalink: string | null; error: string | null;
  test_run: boolean; posted_at: string | null; created_at: string; updated_at: string;
}

export const CATEGORIES = ["School calendar", "Islamic calendar", "Announcements", "Admissions", "Faith & reflection", "Community & volunteers", "Events"];
export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft", needs_date: "Needs date", scheduled: "Scheduled", posting: "Posting…", posted: "Posted", failed: "Failed", skipped: "Skipped",
};
export const STATUS_CLS: Record<PostStatus, string> = {
  draft: "bg-gray-100 text-gray-600", needs_date: "bg-amber-100 text-amber-800", scheduled: "bg-blue-100 text-blue-700",
  posting: "bg-sky-100 text-sky-700", posted: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700", skipped: "bg-gray-200 text-gray-500",
};

/** Replace {placeholders} that have a value; unknown ones stay visible so the poster refuses them. */
export const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] != null && vars[k] !== "" ? vars[k] : m));
export const placeholders = (text: string) => [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))];

// ---------------- card drawing ----------------
const PALETTE: Record<CardStyle, { bg: string; fg: string; sub: string; accent: string }> = {
  navy: { bg: "#1a2f5e", fg: "#ffffff", sub: "#dbe4f5", accent: "#c9a227" },
  gold: { bg: "#f7f1e3", fg: "#1a2f5e", sub: "#3b4a6b", accent: "#c9a227" },
  amber: { bg: "#b45309", fg: "#ffffff", sub: "#fff4e0", accent: "#fde68a" },
  calm: { bg: "#edf3f0", fg: "#1a2f5e", sub: "#3b4a6b", accent: "#2f7d6b" },
};

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export async function drawCard(p: { card_headline: string; card_sub: string; card_style: CardStyle; category: string }): Promise<Blob> {
  const S = 1080, c = document.createElement("canvas"); c.width = S; c.height = S;
  const x = c.getContext("2d")!; const pal = PALETTE[p.card_style] ?? PALETTE.navy;
  x.fillStyle = pal.bg; x.fillRect(0, 0, S, S);
  // double frame + corner diamonds (geometric, no people)
  x.strokeStyle = pal.accent; x.lineWidth = 6; x.strokeRect(40, 40, S - 80, S - 80);
  x.lineWidth = 2; x.strokeRect(58, 58, S - 116, S - 116);
  x.fillStyle = pal.accent;
  for (const [cx, cy] of [[58, 58], [S - 58, 58], [58, S - 58], [S - 58, S - 58]]) { x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4); x.fillRect(-14, -14, 28, 28); x.restore(); }
  if (p.category === "Islamic calendar") {   // crescent
    x.beginPath(); x.arc(S - 190, 200, 70, 0, Math.PI * 2); x.fillStyle = pal.accent; x.fill();
    x.beginPath(); x.arc(S - 160, 180, 62, 0, Math.PI * 2); x.fillStyle = pal.bg; x.fill();
  }
  if (p.card_style === "amber") { x.fillStyle = pal.accent; x.font = "bold 120px system-ui, sans-serif"; x.textAlign = "center"; x.fillText("⚠", S / 2, 270); }
  // logo
  const logo = await loadImg("../images/logo.jpg");
  if (logo && p.card_style !== "amber") { x.save(); x.beginPath(); x.arc(S / 2, 200, 82, 0, Math.PI * 2); x.closePath(); x.clip(); x.drawImage(logo, S / 2 - 82, 118, 164, 164); x.restore();
    x.beginPath(); x.arc(S / 2, 200, 84, 0, Math.PI * 2); x.strokeStyle = pal.accent; x.lineWidth = 4; x.stroke(); }
  // headline + rule + sub text as one block, centred in the band between the logo and the footer;
  // the headline takes the largest size (max 4 lines) that keeps the whole block inside the band
  const TOP = 312, BOTTOM = 862, SUB_LH = 54;
  x.textAlign = "center";
  x.font = "500 40px system-ui, 'Segoe UI', sans-serif";
  const subLines = p.card_sub ? wrap(x, p.card_sub, S - 260).slice(0, 4) : [];
  const subH = subLines.length ? 46 + subLines.length * SUB_LH : 0;
  let size = 110, lines: string[] = [];
  for (; size >= 40; size -= 6) {
    x.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    lines = wrap(x, p.card_headline || "Falah Academy", S - 220);
    if (lines.length <= 4 && lines.length * size * 1.18 + subH <= BOTTOM - TOP) break;
  }
  const lh = size * 1.18, blockH = lines.length * lh + subH;
  let y = TOP + (BOTTOM - TOP - blockH) / 2 + size * 0.9;   // first baseline
  x.fillStyle = pal.fg;
  for (const l of lines) { x.fillText(l, S / 2, y); y += lh; }
  // accent rule + sub text
  if (subLines.length) {
    y += 4 - lh + size * 0.35; x.fillStyle = pal.accent; x.fillRect(S / 2 - 90, y, 180, 5);
    x.fillStyle = pal.sub; x.font = "500 40px system-ui, 'Segoe UI', sans-serif";
    y += 58;
    for (const l of subLines) { x.fillText(l, S / 2, y); y += SUB_LH; }
  }
  // footer
  x.fillStyle = pal.fg; x.font = "600 36px system-ui, 'Segoe UI', sans-serif"; x.fillText("Falah Academy", S / 2, S - 150);
  x.fillStyle = pal.sub; x.font = "400 30px system-ui, 'Segoe UI', sans-serif"; x.fillText("falahacademywa.org · Kent, WA", S / 2, S - 105);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

export async function uploadCard(postId: number, blob: Blob): Promise<string> {
  const path = `cards/${postId}-${Date.now()}.png`;
  const { error } = await supabase.storage.from("social").upload(path, blob, { contentType: "image/png" });
  if (error) throw new Error("Card upload failed: " + error.message);
  return supabase.storage.from("social").getPublicUrl(path).data.publicUrl;
}

// ---------------- dates ----------------
const DAY = 86400000;
const d0 = (iso: string) => new Date(iso + "T12:00:00");
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dayName = (iso: string) => d0(iso).toLocaleDateString("en-US", { weekday: "long" });
export const monthDay = (iso: string) => d0(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const at = (iso: string, h: number, m = 0) => { const d = d0(iso); d.setHours(h, m, 0, 0); return d.toISOString(); };

interface CalEvent { id: string; title: string; event_type: string; start_date: string; end_date: string | null }
const isMoon = (t: string) => /eid|moon|ramadan/i.test(t);

/** Next school day (Mon–Thu) after `iso` that is not inside a holiday event. */
function nextSchoolDay(iso: string, holidays: CalEvent[]): string {
  let d = new Date(d0(iso).getTime() + DAY);
  for (let i = 0; i < 30; i++, d = new Date(d.getTime() + DAY)) {
    const s = isoOf(d), wd = d.getDay();
    if (wd < 1 || wd > 4) continue;
    if (holidays.some((h) => s >= h.start_date && s <= (h.end_date ?? h.start_date))) continue;
    return s;
  }
  return isoOf(d);
}
const mondayOf = (iso: string) => { const d = d0(iso); const wd = d.getDay(); return isoOf(new Date(d.getTime() - ((wd + 6) % 7) * DAY)); };

const WISH: [RegExp, string][] = [
  [/thanksgiving/i, "Have a blessed Thanksgiving with your family!"],
  [/winter/i, "We wish all our families a restful and blessed break!"],
  [/eid|spring/i, "We wish all our families a restful break!"],
];

export interface Draft { template_key: string; category: string; title: string; vars: Record<string, string>; manual: boolean; status: PostStatus; scheduled_at: string | null; source_ref: string }

/** School-calendar drafts (T1, T2, T3, T5) for school-wide events in the next `days` days (approved rules, 2026-11-05). */
export async function calendarDrafts(days = 90): Promise<Draft[]> {
  const today = isoOf(new Date());
  const until = isoOf(new Date(Date.now() + days * DAY));
  const { data } = await supabase.from("calendar_events").select("id, title, event_type, start_date, end_date")
    .is("grade_id", null).gte("start_date", today).lte("start_date", until).order("start_date");
  const { data: hol } = await supabase.from("calendar_events").select("id, title, event_type, start_date, end_date")
    .is("grade_id", null).eq("event_type", "holiday").gte("start_date", isoOf(new Date(Date.now() - 60 * DAY)));
  const holidays = (hol as CalEvent[]) ?? [];
  // "… Begins" holidays carry no end date: the break runs until the next "… Resumes" event
  const { data: res } = await supabase.from("calendar_events").select("id, title, event_type, start_date, end_date")
    .is("grade_id", null).ilike("title", "%resum%").gte("start_date", today).order("start_date");
  const resumes = (res as CalEvent[]) ?? [];
  const breakEnd = (h: CalEvent): string => {
    if (h.end_date || !/begin/i.test(h.title)) return h.end_date ?? h.start_date;
    const r = resumes.find((x) => x.start_date > h.start_date);
    if (!r) return h.start_date;
    let d = new Date(d0(r.start_date).getTime() - DAY);              // last Mon–Thu before resuming
    while (d.getDay() === 0 || d.getDay() >= 5) d = new Date(d.getTime() - DAY);
    return isoOf(d) < h.start_date ? h.start_date : isoOf(d);
  };
  for (const h of holidays) h.end_date = breakEnd(h);
  const out: Draft[] = [];
  for (const e of (data as CalEvent[]) ?? []) {
    const name = e.title.replace(/\s*-\s*No School/i, "").replace(/\s*\(Subject to Moon Sighting\)/i, "").replace(/\s+Begins$/i, "").trim();
    const moon = isMoon(e.title);
    const base = { manual: moon, status: (moon ? "needs_date" : "draft") as PostStatus };
    if (e.event_type === "holiday") {
      const end = breakEnd(e);
      const resume = nextSchoolDay(end, holidays);
      const sched = moon ? null : dayName(e.start_date) === "Monday"
        ? at(isoOf(new Date(d0(e.start_date).getTime() - 4 * DAY)), 17)   // Thursday before, 5 PM
        : at(mondayOf(e.start_date), 8);                                   // Monday of that week, 8 AM
      const multi = end !== e.start_date;
      const vars: Record<string, string> = {
        day: dayName(e.start_date), date: monthDay(e.start_date), event: name, break: name,
        start_day: dayName(e.start_date), start_date: monthDay(e.start_date), end_date: monthDay(end),
        resume_day: dayName(resume), resume_date: monthDay(resume),
        wish: WISH.find(([rx]) => rx.test(name))?.[1] ?? "We wish all our families a restful break!",
      };
      out.push({ ...base, template_key: multi ? "T2" : "T1", category: "School calendar", title: `${name} (${monthDay(e.start_date)})`, vars, scheduled_at: sched, source_ref: `${e.id}:${multi ? "T2" : "T1"}` });
    } else if (/resum/i.test(e.title)) {
      // T3 only after Winter break and after Eid/Spring break; Eid al-Adha: the day before, manual
      const prev = holidays.filter((h) => (h.end_date ?? h.start_date) < e.start_date).sort((a, b) => ((a.end_date ?? a.start_date) < (b.end_date ?? b.start_date) ? 1 : -1))[0];
      if (!prev || /thanksgiving/i.test(prev.title) || !/winter|spring|eid/i.test(prev.title)) continue;
      const adha = /adha/i.test(prev.title);
      const pm = isMoon(prev.title);
      const fri = isoOf(new Date(d0(mondayOf(e.start_date)).getTime() - 3 * DAY));
      const when = adha ? `tomorrow, ${dayName(e.start_date)}, ${monthDay(e.start_date)}` : `on ${dayName(e.start_date)}, ${monthDay(e.start_date)}`;
      out.push({ template_key: "T3", category: "School calendar", title: `School resumes ${monthDay(e.start_date)}`, manual: pm, status: pm ? "needs_date" : "draft",
        vars: { when, resume_day: dayName(e.start_date), resume_date: monthDay(e.start_date) },
        scheduled_at: pm ? null : at(fri, 10), source_ref: `${e.id}:T3` });
    } else if (/last day of school/i.test(e.title)) {
      out.push({ template_key: "T5", category: "School calendar", title: `Last day of school ${monthDay(e.start_date)}`, manual: false, status: "draft",
        vars: { school_year: schoolYearOf(e.start_date) }, scheduled_at: at(mondayOf(e.start_date), 8), source_ref: `${e.id}:T5` });
    }
  }
  return out;
}

export const schoolYearOf = (iso: string) => { const d = d0(iso); const y = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear(); return `${y}–${y + 1}`; };

/** Create a post from a template with some placeholders filled. */
export function fromTemplate(t: SocialTemplate, vars: Record<string, string>, extra: Partial<SocialPost> = {}) {
  return {
    category: t.category, template_key: t.key, title: extra.title ?? t.name,
    body: fill(t.body, vars), card_headline: fill(t.card_headline, vars), card_sub: fill(t.card_sub, vars),
    card_style: t.card_style, manual: t.manual, status: "draft" as PostStatus, source: "template", ...extra,
  };
}

/** Announcement → queued social draft (A-1). Admin-only tick box; all-grades announcements only. */
export async function queueAnnouncement(a: { id: string; title: string; content: string; category: string }) {
  const { data: t } = await supabase.from("social_templates").select("*").eq("key", "A-1").maybeSingle();
  if (!t) return "The social templates are not set up yet (phase 36).";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const row = fromTemplate(t as SocialTemplate, { title: a.title, content: a.content, date: today }, {
    title: `Announcement: ${a.title}`, source: "announcement", source_ref: a.id,
    card_style: a.category === "emergency" ? "amber" : "navy",
  });
  const { error } = await supabase.from("social_posts").insert({ ...row, category: "Announcements" });
  return error ? "Social draft not created: " + error.message : null;
}
