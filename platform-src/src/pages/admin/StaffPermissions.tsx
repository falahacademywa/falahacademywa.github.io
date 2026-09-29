// Settings → Staff & permissions (phase 19). Full admins only.
// A staff member is an ordinary portal login (created in Supabase Auth like a
// parent's) whose profile role is "staff"; this screen grants per-module
// view/edit rights that the database enforces through can_view()/can_edit().
import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { MODULES, type Level } from "../../lib/permissions";

interface StaffRow { id: string; full_name: string; email: string | null; title: string | null; role: string }
type Grid = Record<string, Record<string, Level | "none">>;   // user_id -> module -> level

export default function StaffPermissions() {
  const { profile, session } = useAuth();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const { data: s } = await supabase.from("profiles").select("id, full_name, email, title, role").eq("role", "staff").order("full_name");
    const rows = (s as StaffRow[]) ?? [];
    setStaff(rows);
    const t: Record<string, string> = {}; rows.forEach((r) => { t[r.id] = r.title ?? ""; }); setTitles(t);
    const g: Grid = {};
    rows.forEach((r) => { g[r.id] = Object.fromEntries(MODULES.map((m) => [m.key, "none"])); });
    if (rows.length) {
      const { data: p } = await supabase.from("staff_permissions").select("user_id, module, level").in("user_id", rows.map((r) => r.id));
      ((p as { user_id: string; module: string; level: Level }[]) ?? []).forEach((x) => { if (g[x.user_id]) g[x.user_id][x.module] = x.level; });
    }
    setGrid(g); setDirty({});
  }
  useEffect(() => { load(); }, []);

  if (profile?.role !== "admin") return null;

  async function addStaff(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const em = email.trim().toLowerCase();
    if (!em) return;
    const { data: p } = await supabase.from("profiles").select("id, full_name, role").ilike("email", em).maybeSingle();
    if (!p) return setMsg(`No portal login exists for ${em}. Create it first in Supabase → Authentication → Add user (same as a parent login), then add it here.`);
    if (p.role === "admin") return setMsg(`${p.full_name} is a full admin already.`);
    if (p.role === "staff") return setMsg(`${p.full_name} is already staff.`);
    const { error } = await supabase.from("profiles").update({ role: "staff", title: "Office Staff" }).eq("id", p.id);
    if (error) return setMsg("Could not change the role: " + error.message);
    setEmail(""); setMsg(`${p.full_name} is now staff — grant modules below and save.`); load();
  }

  function setLevel(uid: string, mod: string, level: Level | "none") {
    setGrid({ ...grid, [uid]: { ...grid[uid], [mod]: level } });
    setDirty({ ...dirty, [uid]: true });
  }

  async function save(uid: string) {
    setBusy(uid); setMsg(null);
    const rows = Object.entries(grid[uid] ?? {}).filter(([, l]) => l !== "none")
      .map(([module, level]) => ({ user_id: uid, module, level, granted_by: session?.user.id ?? null }));
    const del = await supabase.from("staff_permissions").delete().eq("user_id", uid);
    const ins = rows.length ? await supabase.from("staff_permissions").insert(rows) : { error: null };
    const tit = await supabase.from("profiles").update({ title: titles[uid]?.trim() || null }).eq("id", uid);
    setBusy(null);
    const err = del.error ?? ins.error ?? tit.error;
    if (err) return setMsg("Save failed: " + err.message);
    setMsg("Saved. The person sees the change on their next page load."); load();
  }

  async function removeStaff(s: StaffRow) {
    if (!confirm(`Remove staff access for ${s.full_name}? Their login stays but opens nothing until re-granted.`)) return;
    await supabase.from("staff_permissions").delete().eq("user_id", s.id);
    await supabase.from("profiles").update({ role: "parent", title: null }).eq("id", s.id);
    load();
  }

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-400">Staff &amp; permissions</h2>
      <p className="mb-3 text-xs text-gray-500">
        Staff are helpers with a portal login but limited rights. Per module: <b>none</b> (hidden), <b>view</b> (read only) or <b>edit</b>.
        The database enforces these, not just the menu. Money, health forms, parent logins and this screen are best kept with full admins.
      </p>
      {msg && <div className="mb-3 rounded-lg bg-silver p-3 text-sm text-gray-700">{msg}</div>}

      {staff.map((s) => (
        <div key={s.id} className="mb-4 rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-navy">{s.full_name}</div>
              <div className="text-xs text-gray-500">{s.email}</div>
            </div>
            <label className="text-xs text-gray-500">Title shown in the portal
              <input value={titles[s.id] ?? ""} onChange={(e) => { setTitles({ ...titles, [s.id]: e.target.value }); setDirty({ ...dirty, [s.id]: true }); }}
                placeholder="Office Staff" className="mt-1 block w-44 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800" />
            </label>
          </div>
          <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {MODULES.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-3 border-b py-1 text-sm last:border-0">
                <span title={m.note}><span className="font-medium text-gray-800">{m.label}</span>{m.note && <span className="ml-1 text-[10px] text-gray-400">ⓘ</span>}</span>
                <select value={grid[s.id]?.[m.key] ?? "none"} onChange={(e) => setLevel(s.id, m.key, e.target.value as Level | "none")}
                  className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                    grid[s.id]?.[m.key] === "edit" ? "border-emerald-300 bg-emerald-50 text-emerald-deep"
                    : grid[s.id]?.[m.key] === "view" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-500"}`}>
                  <option value="none">none</option>
                  <option value="view">view</option>
                  <option value="edit">edit</option>
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => save(s.id)} disabled={busy === s.id || !dirty[s.id]}
              className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">
              {busy === s.id ? "Saving…" : "Save permissions"}
            </button>
            <button onClick={() => removeStaff(s)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Remove staff access</button>
          </div>
        </div>
      ))}
      {!staff.length && <p className="py-2 text-sm text-gray-400">No staff yet.</p>}

      <form onSubmit={addStaff} className="mt-3 flex flex-wrap gap-2">
        <input type="email" required placeholder="email of an existing portal login" value={email} onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <button className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Make staff</button>
      </form>
      <p className="mt-2 text-[11px] text-gray-400">
        New helper? Create the login first (Supabase → Authentication → Add user, with "auto confirm"), give them the temporary password the same way as a parent letter, then type the email here.
      </p>
    </section>
  );
}
