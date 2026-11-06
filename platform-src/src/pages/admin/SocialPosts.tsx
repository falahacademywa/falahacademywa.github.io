// Admin → Social posts (phase 36, TODO #110): the Facebook + Instagram queue.
//   Queue: drafts, "needs date" (moon-related), scheduled and failed posts. Edit the text and the
//   card, then Post (President/admins; staff with edit only the T6 closure posts) or, for the fixed
//   school-calendar posts, Approve & schedule. Archive: posted/skipped, Academic year → Month →
//   Category, kept 2 years. Templates: the approved texts, editable here.
// STRICT (President 2026-11-05): never any photo of a child. Images are drawn text cards or an
// uploaded graphic with the "no children in this image" confirmation. No fees, no names.
import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { monthLabel } from "../../lib/calendar";
import GroupedArchive, { academicYearOf, ymOf } from "../../components/GroupedArchive";
import {
  type SocialPost, type SocialTemplate, type CardStyle, STATUS_LABEL, STATUS_CLS, CATEGORIES,
  calendarDrafts, drawCard, fill, fromTemplate, placeholders, uploadCard,
} from "../../lib/social";

const OPEN = ["needs_date", "failed", "draft", "scheduled", "posting"] as const;
const HEAD: Record<string, string> = { needs_date: "Needs a date (moon-related): set it, then post by hand", failed: "Failed — check and try again", draft: "Drafts", scheduled: "Scheduled (posts on its own)", posting: "Posting…" };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const localInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function SocialPosts() {
  const { can, profile } = useAuth();
  const canEdit = can("social", "edit");
  const [tab, setTab] = useState<"queue" | "templates">("queue");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [tpls, setTpls] = useState<SocialTemplate[]>([]);
  const [faithLeft, setFaithLeft] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [p, t, f] = await Promise.all([
      supabase.from("social_posts").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("social_templates").select("*").order("sort"),
      supabase.from("social_faith_bank").select("n", { count: "exact", head: true }).is("used_post", null),
    ]);
    if (p.error) { setErr(p.error.message.includes("social_posts") ? "The social queue is not set up on this project yet (phase 36)." : p.error.message); return; }
    setPosts((p.data as SocialPost[]) ?? []); setTpls((t.data as SocialTemplate[]) ?? []); setFaithLeft(f.count ?? 0);
  }
  useEffect(() => { load(); if (canEdit) supabase.rpc("social_purge_old"); }, []);

  async function addFromTemplate() {
    const t = tpls.find((x) => x.key === newKey); if (!t) return;
    setBusy(true);
    const { error } = await supabase.from("social_posts").insert({ ...fromTemplate(t, {}), created_by: profile?.id });
    setBusy(false); setNewKey("");
    setMsg(error ? "Could not add: " + error.message : `Added "${t.name}" to the drafts — fill in the {placeholders}, then post.`); load();
  }
  async function nextFaith() {
    setBusy(true); setMsg(null);
    const t = tpls.find((x) => x.key === "FR-1");
    const { data: item } = await supabase.from("social_faith_bank").select("*").is("used_post", null).order("n").limit(1).maybeSingle();
    if (!t || !item) { setBusy(false); return setMsg("The Faith & reflection bank is empty — ask Claude for more items."); }
    const it = item as { n: number; kind: string; meaning: string; reference: string; tip: string };
    const { data, error } = await supabase.from("social_posts").insert({
      ...fromTemplate(t, { meaning: it.meaning, reference: it.reference, family_tip: it.tip }, { title: `Faith #${it.n}: ${it.reference}`, source: "faith", source_ref: String(it.n) }),
      created_by: profile?.id,
    }).select("id").single();
    if (!error && data) await supabase.from("social_faith_bank").update({ used_post: (data as { id: number }).id, used_at: new Date().toISOString() }).eq("n", it.n);
    setBusy(false); setMsg(error ? "Could not add: " + error.message : `Faith & reflection #${it.n} added to the drafts.`); load();
  }
  async function fromCalendar() {
    setBusy(true); setMsg(null);
    const drafts = await calendarDrafts(90);
    let added = 0;
    for (const d of drafts) {
      const t = tpls.find((x) => x.key === d.template_key); if (!t) continue;
      const { error } = await supabase.from("social_posts").insert({
        ...fromTemplate(t, d.vars, { title: d.title, source: "calendar", source_ref: d.source_ref }),
        manual: d.manual, status: d.status, scheduled_at: d.scheduled_at, created_by: profile?.id,
      });
      if (!error) added++;
    }
    setBusy(false); setMsg(added ? `${added} calendar post(s) added for the next 90 days. Check each one, then Approve & schedule.` : "No new calendar posts for the next 90 days."); load();
  }

  const open = posts.filter((p) => (OPEN as readonly string[]).includes(p.status));
  const done = posts.filter((p) => p.status === "posted" || p.status === "skipped");

  if (err) return <div className="p-6"><p className="rounded-xl bg-white p-4 text-sm text-red-700 shadow-sm">{err}</p></div>;
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-navy">Social posts</h1>
        <p className="mt-1 text-sm text-gray-500">Facebook page and Instagram queue. <b className="text-red-700">Never any photo of a child</b> — cards are drawn as graphics. No fees, no names. Moon-related and Islamic posts are always posted by hand.</p>
      </div>
      <div className="flex gap-2 border-b border-gray-200">
        {(["queue", "templates"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? "border-navy text-navy" : "border-transparent text-gray-400"}`}>
            {t === "queue" ? `Queue (${open.length})` : `Templates (${tpls.length})`}
          </button>
        ))}
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-deep">{msg}</p>}

      {tab === "queue" && (
        <>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
              <select value={newKey} onChange={(e) => setNewKey(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">+ New post from a template…</option>
                {CATEGORIES.map((c) => (
                  <optgroup key={c} label={c}>{tpls.filter((t) => t.category === c && t.active).map((t) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>)}</optgroup>
                ))}
              </select>
              <button onClick={addFromTemplate} disabled={!newKey || busy} className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Add</button>
              <span className="mx-1 h-6 w-px bg-gray-200" />
              <button onClick={nextFaith} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700">Next Faith post{faithLeft != null ? ` (${faithLeft} left)` : ""}</button>
              <button onClick={fromCalendar} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700">From calendar (90 days)</button>
            </div>
          )}
          {open.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">The queue is empty.</p>}
          {OPEN.map((s) => {
            const list = open.filter((p) => p.status === s).sort((a, b) => ((a.scheduled_at ?? a.created_at) < (b.scheduled_at ?? b.created_at) ? -1 : 1));
            if (!list.length) return null;
            return (
              <section key={s} className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{HEAD[s]} ({list.length})</h2>
                {list.map((p) => <PostEditor key={p.id} p={p} onChanged={load} onPosted={(m) => { setMsg(m); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
              </section>
            );
          })}
          <GroupedArchive items={done} noun="post" note="Posted and skipped posts, kept for 2 years."
            levels={[
              { key: (p) => academicYearOf(p.posted_at ?? p.updated_at), label: (k) => `${k} school year` },
              { key: (p) => ymOf(p.posted_at ?? p.updated_at), label: monthLabel },
              { key: (p) => p.category, order: (a, b) => a.localeCompare(b) },
            ]}
            render={(p) => <ArchivedPost p={p} />} />
        </>
      )}
      {tab === "templates" && <Templates tpls={tpls} canEdit={canEdit} onChanged={load} />}
    </div>
  );
}

function ArchivedPost({ p }: { p: SocialPost }) {
  return (
    <div className="rounded-xl bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
        {p.test_run && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">TEST (dev, not published)</span>}
        <span className="font-semibold text-gray-800">{p.title}</span>
        <span className="text-xs text-gray-400">{p.posted_at ? fmt(p.posted_at) : ""}</span>
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-gray-600">{p.body}</p>
      <div className="mt-1 flex gap-3 text-xs">
        {p.fb_post_id && !p.test_run && <a className="text-navy underline" href={`https://www.facebook.com/${p.fb_post_id}`} target="_blank" rel="noreferrer">Facebook post</a>}
        {p.ig_permalink && <a className="text-navy underline" href={p.ig_permalink} target="_blank" rel="noreferrer">Instagram post</a>}
        {(p.card_url || p.image_url) && <a className="text-navy underline" href={p.image_url ?? p.card_url!} target="_blank" rel="noreferrer">Image</a>}
      </div>
    </div>
  );
}

function PostEditor({ p, onChanged, onPosted }: { p: SocialPost; onChanged: () => void; onPosted: (msg: string) => void }) {
  const { profile, can } = useAuth();
  const isAdmin = profile?.role === "admin";
  const canEdit = can("social", "edit");
  const canPost = isAdmin || (canEdit && (p.template_key ?? "").startsWith("T6"));
  const [open, setOpen] = useState(p.status === "failed");
  const [f, setF] = useState({ title: p.title, body: p.body, card_headline: p.card_headline, card_sub: p.card_sub, card_style: p.card_style,
    platforms: p.platforms, scheduled: localInput(p.scheduled_at), noKids: p.image_no_children });
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const missing = useMemo(() => placeholders(f.body + " " + f.card_headline + " " + f.card_sub), [f.body, f.card_headline, f.card_sub]);
  const dirty = f.title !== p.title || f.body !== p.body || f.card_headline !== p.card_headline || f.card_sub !== p.card_sub
    || f.card_style !== p.card_style || f.platforms.join() !== p.platforms.join() || f.scheduled !== localInput(p.scheduled_at) || f.noKids !== p.image_no_children || !!file;

  async function save(extra: Record<string, unknown> = {}): Promise<boolean> {
    setErr(null);
    let image_url = p.image_url;
    if (file) {
      if (!f.noKids) { setErr("Tick “No children in this image” — photos of children are never posted."); return false; }
      const path = `uploads/${p.id}-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
      const { error } = await supabase.storage.from("social").upload(path, file, { contentType: file.type });
      if (error) { setErr("Upload failed: " + error.message); return false; }
      image_url = supabase.storage.from("social").getPublicUrl(path).data.publicUrl;
    }
    const cardChanged = f.card_headline !== p.card_headline || f.card_sub !== p.card_sub || f.card_style !== p.card_style;
    const { error } = await supabase.from("social_posts").update({
      title: f.title, body: f.body, card_headline: f.card_headline, card_sub: f.card_sub, card_style: f.card_style,
      platforms: f.platforms, image_url, image_no_children: image_url ? f.noKids : false,
      scheduled_at: f.scheduled ? new Date(f.scheduled).toISOString() : null,
      ...(cardChanged ? { card_url: null } : {}), ...extra,
    }).eq("id", p.id);
    if (error) { setErr(error.message); return false; }
    setFile(null); return true;
  }
  async function ensureCard(): Promise<boolean> {
    if (file || p.image_url) return true;
    const cardChanged = f.card_headline !== p.card_headline || f.card_sub !== p.card_sub || f.card_style !== p.card_style;
    if (p.card_url && !cardChanged) return true;
    const url = await uploadCard(p.id, await drawCard({ ...f, category: p.category }));
    const { error } = await supabase.from("social_posts").update({ card_url: url }).eq("id", p.id);
    if (error) { setErr(error.message); return false; }
    return true;
  }
  async function act(name: string, fn: () => Promise<void>) { setBusy(name); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); onChanged(); } }

  const postNow = () => act("post", async () => {
    if (missing.length) throw new Error("Fill in: " + missing.map((m) => `{${m}}`).join(", "));
    if (!f.platforms.length) throw new Error("Choose Facebook and/or Instagram.");
    if (!window.confirm(`Post "${f.title}" now to ${f.platforms.join(" and ")}?`)) return;
    if (!(await save({ status: "draft" })) || !(await ensureCard())) return;
    const { data, error } = await supabase.functions.invoke("social-post", { body: { post_id: p.id } });
    if (error) {
      let detail = error.message;
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) detail = b.error; } catch { /* keep message */ }
      throw new Error(detail);
    }
    const r = data as { ok?: boolean; error?: string; test?: boolean; skipped?: string; ig_permalink?: string | null };
    if (r?.ok === false) throw new Error(r.error ?? "Posting failed");
    if (r?.skipped) { onPosted(`"${f.title}" was not posted again: ${r.skipped}.`); return; }
    onPosted(r?.test
      ? `TEST MODE: "${f.title}" went through to ${f.platforms.join(" and ")} as a hidden test post (nothing is visible on the page). It is now in the Archive.`
      : `Posted "${f.title}" to ${f.platforms.join(" and ")}. It is now in the Archive.`);
  });
  const schedule = () => act("schedule", async () => {
    if (missing.length) throw new Error("Fill in: " + missing.map((m) => `{${m}}`).join(", "));
    if (!f.scheduled) throw new Error("Pick the date and time.");
    if (new Date(f.scheduled) < new Date()) throw new Error("That time has passed.");
    if (!(await save()) || !(await ensureCard())) return;
    const { error } = await supabase.from("social_posts").update({ status: "scheduled" }).eq("id", p.id);
    if (error) throw new Error(error.message);
  });
  const status = (s: string) => act(s, async () => { const { error } = await supabase.from("social_posts").update({ status: s }).eq("id", p.id); if (error) throw new Error(error.message); });
  const del = () => act("delete", async () => {
    if (!window.confirm(`Delete "${p.title}" from the queue?`)) return;
    const { error } = await supabase.from("social_posts").delete().eq("id", p.id); if (error) throw new Error(error.message);
  });
  const showPreview = async () => { setErr(null); const b = await drawCard({ ...f, category: p.category }); setPreview(URL.createObjectURL(b)); };

  const input = "w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm";
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40";
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-800">{p.title || "(untitled)"}</span>
          <span className="block text-[11px] text-gray-500">{p.category}{p.template_key ? ` · ${p.template_key}` : ""} · {p.manual ? "manual (you click Post)" : "may be scheduled"}{p.scheduled_at ? ` · ${p.status === "scheduled" ? "posts" : "suggested"} ${fmt(p.scheduled_at)}` : ""}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      </button>
      {p.error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{p.error}</p>}
      {open && (
        <div className="mt-3 grid gap-3 border-t border-gray-100 pt-3 md:grid-cols-[1fr_220px]">
          <div className="space-y-2">
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!canEdit} className={input} placeholder="Internal label" />
            <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} disabled={!canEdit} rows={11} className={input + " font-mono text-[13px]"} />
            {missing.length > 0 && <p className="text-xs font-semibold text-amber-700">Still to fill in: {missing.map((m) => `{${m}}`).join(", ")}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={f.card_headline} onChange={(e) => setF({ ...f, card_headline: e.target.value })} disabled={!canEdit} className={input} placeholder="Card headline" />
              <input value={f.card_sub} onChange={(e) => setF({ ...f, card_sub: e.target.value })} disabled={!canEdit} className={input} placeholder="Card line under it" />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <label>Card style <select value={f.card_style} onChange={(e) => setF({ ...f, card_style: e.target.value as CardStyle })} disabled={!canEdit} className="ml-1 rounded border border-gray-300 px-1.5 py-1">
                {["navy", "gold", "amber", "calm"].map((s) => <option key={s}>{s}</option>)}</select></label>
              {["facebook", "instagram"].map((pl) => (
                <label key={pl} className="flex items-center gap-1"><input type="checkbox" checked={f.platforms.includes(pl)} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, platforms: e.target.checked ? [...f.platforms, pl] : f.platforms.filter((x) => x !== pl) })} /> {pl === "facebook" ? "Facebook" : "Instagram"}</label>
              ))}
              {!p.manual && <label>Post at <input type="datetime-local" value={f.scheduled} onChange={(e) => setF({ ...f, scheduled: e.target.value })} disabled={!canEdit} className="ml-1 rounded border border-gray-300 px-1.5 py-1" /></label>}
            </div>
            <div className="rounded-lg bg-silver/60 p-2 text-xs text-gray-600">
              <div className="font-semibold text-gray-700">Own image instead of the card (optional)</div>
              <input type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!canEdit} className="mt-1 block text-xs" />
              <label className="mt-1 flex items-center gap-1.5 font-semibold text-red-700"><input type="checkbox" checked={f.noKids} onChange={(e) => setF({ ...f, noKids: e.target.checked })} disabled={!canEdit} /> No children in this image (required)</label>
              {p.image_url && <div className="mt-1">Using an uploaded image. <a className="underline" href={p.image_url} target="_blank" rel="noreferrer">View</a> · <button className="underline" onClick={() => act("noimg", async () => { await supabase.from("social_posts").update({ image_url: null, image_no_children: false }).eq("id", p.id); })}>Use the card instead</button></div>}
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => act("save", async () => { await save(); })} disabled={!!busy || !dirty} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Save</button>
                {canPost && <button onClick={postNow} disabled={!!busy} className={`${btn} bg-navy text-white`}>{busy === "post" ? "Posting…" : "Post now"}</button>}
                {isAdmin && !p.manual && p.status !== "scheduled" && <button onClick={schedule} disabled={!!busy} className={`${btn} bg-blue-600 text-white`}>Approve & schedule</button>}
                {p.status === "scheduled" && <button onClick={() => status("draft")} disabled={!!busy} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Unschedule</button>}
                <button onClick={() => status("skipped")} disabled={!!busy} className={`${btn} border border-gray-300 bg-white text-gray-500`}>Skip</button>
                <button onClick={del} disabled={!!busy} className={`${btn} border border-red-200 bg-white text-red-700`}>Delete</button>
                {!canPost && <span className="self-center text-xs text-gray-500">The President or an admin posts this one.</span>}
              </div>
            )}
            {err && <p className="text-xs text-red-700">{err}</p>}
          </div>
          <div className="space-y-2">
            {(p.image_url || (p.card_url && !preview)) && <img src={p.image_url ?? p.card_url!} alt="Post image" className="w-full rounded-lg border border-gray-200" />}
            {preview && <img src={preview} alt="Card preview" className="w-full rounded-lg border border-gray-200" />}
            {!p.image_url && <button onClick={showPreview} className={`${btn} w-full border border-gray-300 bg-white text-gray-700`}>{preview || p.card_url ? "Refresh card preview" : "Preview card"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Templates({ tpls, canEdit, onChanged }: { tpls: SocialTemplate[]; canEdit: boolean; onChanged: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">The approved texts. Changes apply to new posts only. {"{placeholders}"} are filled from the calendar or by hand before posting.</p>
      {CATEGORIES.map((c) => {
        const list = tpls.filter((t) => t.category === c);
        if (!list.length) return null;
        return (
          <section key={c} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{c}</h2>
            {list.map((t) => <TemplateRow key={t.key} t={t} canEdit={canEdit} onChanged={onChanged} />)}
          </section>
        );
      })}
    </div>
  );
}

function TemplateRow({ t, canEdit, onChanged }: { t: SocialTemplate; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ body: t.body, card_headline: t.card_headline, card_sub: t.card_sub, card_style: t.card_style, active: t.active });
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const { error } = await supabase.from("social_templates").update({ ...f, updated_at: new Date().toISOString() }).eq("key", t.key);
    setMsg(error ? error.message : "Saved."); onChanged();
  }
  const input = "w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm";
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="rounded bg-silver px-1.5 py-0.5 text-[11px] font-bold text-navy">{t.key}</span>
        <span className="flex-1 text-sm font-semibold text-gray-800">{t.name}</span>
        <span className="text-[11px] text-gray-400">{t.manual ? "manual" : "may be scheduled"}{t.active ? "" : " · off"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} disabled={!canEdit} rows={10} className={input + " font-mono text-[13px]"} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={f.card_headline} onChange={(e) => setF({ ...f, card_headline: e.target.value })} disabled={!canEdit} className={input} placeholder="Card headline" />
            <input value={f.card_sub} onChange={(e) => setF({ ...f, card_sub: e.target.value })} disabled={!canEdit} className={input} placeholder="Card line" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <label>Card style <select value={f.card_style} onChange={(e) => setF({ ...f, card_style: e.target.value as CardStyle })} disabled={!canEdit} className="ml-1 rounded border border-gray-300 px-1.5 py-1">
              {["navy", "gold", "amber", "calm"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} disabled={!canEdit} /> In use</label>
            {canEdit && <button onClick={save} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white">Save template</button>}
            {msg && <span>{msg}</span>}
          </div>
          <p className="text-[11px] text-gray-400">Placeholders: {fill(f.body, {}).match(/\{[a-z_]+\}/g)?.join(" ") || "none"}</p>
        </div>
      )}
    </div>
  );
}
