import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { usPhone } from "../../lib/format";

// A "parent" is a person in the guardians registry. The same person appears
// once per child, so this page is keyed by one guardian row and gathers every
// row that belongs to the same person (same email, or same name+phone when
// there is no email), plus the portal account with that email, if any.
interface GRow {
  id: string; student_id: string; name: string; relationship: string; phone: string | null; email: string | null; sort: number;
  students: { id: string; first_name: string; last_name: string; student_no: number; archived: boolean;
              enrollments: { grade_name: string; status: string }[] };
}
interface Account {
  id: string; full_name: string; email: string | null; phone: string | null; address: string | null;
  suspended: boolean; must_change_password: boolean;
  parent_students: { student_id: string; students: { id: string; first_name: string; last_name: string } }[];
}
interface StudentOpt { id: string; first_name: string; last_name: string }

const rel = (r: string) => ({ father: "Father", mother: "Mother" }[r.toLowerCase()] ?? r.charAt(0).toUpperCase() + r.slice(1));
export const RelBadge = ({ r, size = "sm" }: { r: string; size?: "sm" | "lg" }) => {
  const l = r.toLowerCase();
  const letter = l === "father" ? "F" : l === "mother" ? "M" : "G";
  const cls = l === "father" ? "bg-navy text-white" : l === "mother" ? "bg-rose-500 text-white" : "bg-gray-400 text-white";
  const dim = size === "lg" ? "h-8 w-8 text-sm" : "h-5 w-5 text-[10px]";
  return <span title={rel(r)} className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${dim} ${cls}`}>{letter}</span>;
};

export default function ParentProfile() {
  const { id } = useParams();
  const [rows, setRows] = useState<GRow[]>([]);          // this person's guardian rows (one per child)
  const [others, setOthers] = useState<GRow[]>([]);      // the other parents/guardians of those children
  const [account, setAccount] = useState<Account | null>(null);
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const SEL = "id, student_id, name, relationship, phone, email, sort, students ( id, first_name, last_name, student_no, archived, enrollments ( grade_name, status ) )";

  async function load() {
    if (configMissing || !id) return;
    const { data: g0, error } = await supabase.from("guardians").select(SEL).eq("id", id).single();
    if (error || !g0) { setErr(error?.message ?? "Parent not found"); return; }
    const me = g0 as unknown as GRow;
    let q = supabase.from("guardians").select(SEL);
    q = me.email ? q.ilike("email", me.email) : q.eq("name", me.name).eq("phone", me.phone ?? "");
    const { data: mine } = await q;
    const mineRows = ((mine as unknown as GRow[]) ?? []).filter((r) => r.students && !r.students.archived);
    const list = mineRows.length ? mineRows : [me];
    setRows(list);
    const childIds = [...new Set(list.map((r) => r.student_id))];
    const { data: oth } = await supabase.from("guardians").select(SEL).in("student_id", childIds);
    setOthers(((oth as unknown as GRow[]) ?? []).filter((r) => !list.some((m) => m.id === r.id)));
    if (me.email) {
      const { data: acc } = await supabase.from("profiles")
        .select("id, full_name, email, phone, address, suspended, must_change_password, parent_students ( student_id, students ( id, first_name, last_name ) )")
        .eq("role", "parent").ilike("email", me.email).maybeSingle();
      setAccount((acc as unknown as Account) ?? null);
      const { data: logins } = await supabase.rpc("admin_parent_logins");
      const hit = ((logins as { email: string | null; last_sign_in_at: string | null }[]) ?? [])
        .find((r) => r.email?.toLowerCase() === me.email!.toLowerCase());
      setLastLogin(hit?.last_sign_in_at ?? null);
    } else { setAccount(null); setLastLogin(null); }
    const { data: s } = await supabase.from("students").select("id, first_name, last_name").eq("archived", false).order("last_name");
    setStudents(s ?? []);
  }
  useEffect(() => { load(); }, [id]);

  async function makePrimary(g: GRow) {
    await supabase.from("guardians").update({ sort: 2 }).eq("student_id", g.student_id).neq("id", g.id);
    await supabase.from("guardians").update({ sort: 1 }).eq("id", g.id);
    load();
  }
  async function link(studentId: string) {
    if (!account) return;
    const { error } = await supabase.from("parent_students").insert({ parent_id: account.id, student_id: studentId });
    if (error) setErr("Link failed: " + error.message);
    setLinking(false); load();
  }
  async function unlink(studentId: string) {
    if (!account) return;
    await supabase.from("parent_students").delete().eq("parent_id", account.id).eq("student_id", studentId);
    load();
  }
  async function toggleSuspend() {
    if (!account) return;
    await supabase.from("profiles").update({ suspended: !account.suspended }).eq("id", account.id);
    load();
  }

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!rows.length) return <p className="text-sm text-gray-400">Loading…</p>;
  const me = rows[0];
  const status = !account ? { label: "No portal account", cls: "bg-gray-200 text-gray-700" }
    : account.suspended ? { label: "Suspended", cls: "bg-red-100 text-red-700" }
    : account.must_change_password ? { label: "Invited — hasn't signed in", cls: "bg-amber-100 text-amber-800" }
    : { label: "Account active", cls: "bg-green-100 text-green-700" };
  const loginLabel = (() => {
    if (!lastLogin) return "never";
    const days = Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86400000);
    return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  })();
  const otherParents = [...new Map(others.map((o) => [(o.email ?? o.name).toLowerCase(), o])).values()];

  return (
    <div className="max-w-4xl">
      <Link to="/admin/parents" className="text-xs text-gray-500 hover:text-navy">← Parents</Link>

      <div className="mt-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-navy">
              {me.name} <RelBadge r={me.relationship} />
              <span className="text-base font-normal text-gray-400">({rel(me.relationship)})</span>
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              {me.phone && <span>📞 {usPhone(account?.phone ?? me.phone)}</span>}
              {me.email && <span>✉️ {me.email}</span>}
              {account?.address && <span>🏠 {account.address}</span>}
            </div>
          </div>
          <div className="text-right">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>{status.label}</span>
            {account && <div className="mt-1.5 text-xs text-gray-500">Last sign-in: <span className="font-semibold text-navy">{loginLabel}</span></div>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Children</h2>
          <div className="space-y-2">
            {rows.map((r) => {
              const grade = r.students.enrollments?.find((e) => e.status === "active")?.grade_name ?? r.students.enrollments?.[0]?.grade_name;
              const linked = account?.parent_students.some((ps) => ps.student_id === r.student_id);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm">
                  <Link to={`/admin/students/${r.student_id}`} className="font-semibold text-navy hover:text-royal hover:underline">
                    {r.students.first_name} {r.students.last_name}
                  </Link>
                  <span className="text-xs text-gray-400">#{String(r.students.student_no).padStart(5, "0")}{grade ? ` · ${grade}` : ""}</span>
                  {r.sort === 1
                    ? <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-navy">Primary contact</span>
                    : <button onClick={() => makePrimary(r)} className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-silver">Make primary contact</button>}
                  {account && (linked
                    ? <span className="ml-auto text-[10px] text-green-700">linked to portal ✓</span>
                    : <button onClick={() => link(r.student_id)} className="ml-auto text-[10px] font-semibold text-royal hover:underline">Link to portal account</button>)}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Other parents / guardians</h2>
          {otherParents.length ? otherParents.map((o) => (
            <div key={o.id} className="border-b py-2 text-sm last:border-0">
              <div className="flex items-center gap-2">
                <Link to={`/admin/parents/${o.id}`} className="font-semibold text-navy hover:text-royal hover:underline">{o.name}</Link>
                <RelBadge r={o.relationship} />
                <span className="text-xs text-gray-400">({rel(o.relationship)})</span>
              </div>
              <div className="mt-0.5 text-gray-600">
                {o.phone && <span className="mr-3">📞 {usPhone(o.phone)}</span>}
                {o.email && <span>✉️ {o.email}</span>}
              </div>
            </div>
          )) : <p className="text-sm text-gray-400">None on file.</p>}
        </section>
      </div>

      {account && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Portal account</h2>
            <div className="flex gap-2">
              <button onClick={() => setLinking(!linking)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Link another child</button>
              <button onClick={toggleSuspend} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">{account.suspended ? "Reactivate" : "Suspend"}</button>
              <Link to="/admin/parent-activity" className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Activity</Link>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">Login: <span className="font-semibold text-navy">{account.email}</span> · Name on account: {account.full_name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {account.parent_students.map((ps) => (
              <span key={ps.student_id} className="flex items-center gap-1.5 rounded-full bg-silver px-3 py-1 text-xs font-semibold text-navy">
                {ps.students.first_name} {ps.students.last_name}
                <button onClick={() => unlink(ps.student_id)} title="Unlink" className="text-gray-400 hover:text-red-600">✕</button>
              </span>
            ))}
            {!account.parent_students.length && <span className="text-xs text-gray-400">No children linked to this login.</span>}
          </div>
          {linking && (
            <select defaultValue="" onChange={(e) => { if (e.target.value) link(e.target.value); }}
              className="mt-3 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="" disabled>Select a student to link…</option>
              {students.filter((s) => !account.parent_students.some((ps) => ps.student_id === s.id))
                .map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          )}
        </section>
      )}
      {!account && me.email && (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          No portal login exists for <span className="font-semibold">{me.email}</span>. Create it in the Supabase dashboard (Authentication → Users), then link the children here.
        </p>
      )}
    </div>
  );
}
