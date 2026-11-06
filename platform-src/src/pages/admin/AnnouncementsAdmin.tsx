import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import OldAnnouncements from "../../components/OldAnnouncements";
import { queueAnnouncement } from "../../lib/social";

interface Ann {
  id: string;
  title: string;
  content: string;
  category: string;
  grade_id: number | null;
  grades: { name: string } | null;
  is_pinned: boolean;
  requires_ack: boolean;
  status: string;
  publish_date: string | null;
  archived_at: string | null;
  created_at: string;
  announcement_acks: { parent_id: string }[];
}

const CATEGORIES = ["general", "reminder", "academic", "religious", "emergency", "event"] as const;
const catStyles: Record<string, string> = {
  general: "bg-gray-100 text-gray-600",
  reminder: "bg-amber-100 text-amber-800",
  academic: "bg-blue-100 text-blue-700",
  religious: "bg-emerald-50 text-emerald-deep",
  emergency: "bg-red-100 text-red-700",
  event: "bg-purple-100 text-purple-700",
};

const emptyForm = { title: "", content: "", category: "general", grade_id: "", is_pinned: false, requires_ack: false, social: false };

export default function AnnouncementsAdmin() {
  const { profile, can } = useAuth();
  const canEdit = can("announcements", "edit");
  const isAdminRole = profile?.role === "admin";
  const [rows, setRows] = useState<Ann[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data }, { data: g }] = await Promise.all([
      supabase.from("announcements")
        .select("*, grades ( name ), announcement_acks ( parent_id )")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
    ]);
    setRows((data as unknown as Ann[]) ?? []);
    setGrades(g ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save(status: "draft" | "published") {
    if (!form.title || !form.content) return setMsg("Title and content are required.");
    const { data: saved, error } = await supabase.from("announcements").insert({
      title: form.title,
      content: form.content,
      category: form.category,
      grade_id: form.grade_id ? Number(form.grade_id) : null,
      is_pinned: form.is_pinned,
      requires_ack: form.requires_ack,
      status,
      publish_date: status === "published" ? new Date().toISOString() : null,
      created_by: profile?.id,
    }).select("id").single();
    if (error) return setMsg("Save failed: " + error.message);
    // Also post on Facebook / Instagram (phase 36): President/admins, all-grades announcements only.
    // Publishing puts a ready draft in Admin → Social posts; the President or an admin clicks Post there.
    if (status === "published" && form.social && isAdminRole && !form.grade_id && saved) {
      const err = await queueAnnouncement({ id: (saved as { id: string }).id, title: form.title, content: form.content, category: form.category });
      if (err) { setForm({ ...emptyForm }); setShowForm(false); load(); return setMsg(err); }
    }
    setForm({ ...emptyForm });
    setShowForm(false);
    setMsg(null);
    load();
  }

  async function update(id: string, patch: Record<string, unknown>) {
    const { error } = await supabase.from("announcements").update(patch).eq("id", id);
    setMsg(error ? "Update failed: " + error.message : null);
    load();
  }

  const current = rows.filter((a) => a.status !== "archived");
  const old = rows.filter((a) => a.status === "archived");

  function card(a: Ann) {
    return (
      <div key={a.id} className={`rounded-xl border p-4 shadow-sm ${a.status === "archived" ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}>
        <div className="flex flex-wrap items-center gap-2">
          {a.is_pinned && a.status !== "archived" && <span title="Pinned">📌</span>}
          <span className="font-semibold text-navy">{a.title}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${catStyles[a.category]}`}>{a.category}</span>
          {a.grade_id && <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs text-navy">{a.grades?.name}</span>}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.status === "published" ? "bg-green-100 text-green-700" : a.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-gray-200 text-gray-600"}`}>{a.status}</span>
          {a.requires_ack && (
            <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs text-navy">
              {a.announcement_acks.length} ack{a.announcement_acks.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto text-xs text-gray-400">
            {a.publish_date ? new Date(a.publish_date).toLocaleDateString() : "not published"}
            {a.archived_at ? ` · archived ${new Date(a.archived_at).toLocaleDateString()}` : ""}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{a.content}</p>
        {canEdit && (
          <div className="mt-3 flex gap-2 border-t border-gray-100 pt-2">
            {a.status === "draft" && (
              <button onClick={() => update(a.id, { status: "published", publish_date: new Date().toISOString() })}
                className="rounded-lg bg-emerald-brand px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-deep">Publish</button>
            )}
            {a.status !== "archived" ? (
              <>
                <button onClick={() => update(a.id, { is_pinned: !a.is_pinned })}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">
                  {a.is_pinned ? "Unpin" : "Pin"}
                </button>
                <button onClick={() => update(a.id, { status: "archived" })} title="Move to Old announcements (parents still see it there this school year)"
                  className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">Archive</button>
              </>
            ) : (
              <button onClick={() => update(a.id, { status: a.publish_date ? "published" : "draft" })} title="Back to the current announcements; parents are not notified again"
                className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">Restore</button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-navy">Announcements</h1>
        {canEdit && <button onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-emerald-brand px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-deep">
          {showForm ? "Cancel" : "+ New Announcement"}
        </button>}
      </div>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage announcements.</p>}

      {showForm && (
        <div className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <input placeholder="Title" className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea placeholder="Write the announcement…" rows={4} className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <div className="flex flex-wrap items-center gap-4">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
            <select value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm">
              <option value="">Entire school</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name} only</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.is_pinned} onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} /> Pin
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.requires_ack} onChange={(e) => setForm({ ...form, requires_ack: e.target.checked })} /> Require acknowledgement
            </label>
            {isAdminRole && !form.grade_id && (
              <label className="flex items-center gap-2 text-sm text-gray-600" title="On Publish, a draft goes to Admin → Social posts; you click Post there after checking it (no names, no photos of children, nothing private).">
                <input type="checkbox" checked={form.social} onChange={(e) => setForm({ ...form, social: e.target.checked })} /> Also post on Facebook / Instagram
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => save("published")}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Publish</button>
            <button onClick={() => save("draft")}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Save draft</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {current.map((a) => card(a))}
        {!configMissing && !current.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            {old.length ? "No current announcements." : "No announcements yet."}
          </p>
        )}
      </div>
      <OldAnnouncements items={old} render={(a) => card(a)}
        note="Archived announcements, by the month they were published. Parents see the ones from this school year (July – June); Restore puts one back with the current announcements without notifying parents again." />
    </div>
  );
}
