import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { usPhone } from "../../lib/format";

interface GuardianRow {
  id: string;
  student_id: string;
  name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  sort: number;
  students: { id: string; first_name: string; last_name: string; archived: boolean };
}
interface ParentAccount {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  suspended: boolean;
  must_change_password: boolean;
  parent_students: { student_id: string; students: { first_name: string; last_name: string } }[];
}
interface StudentOpt { id: string; first_name: string; last_name: string }
interface Member { id: string; name: string; relationship: string; phone: string | null; email: string | null }
interface Family { primary: Member; members: Member[]; kids: { id: string; label: string }[] }

type SortKey = "name" | "children" | "status";

export default function Parents() {
  const nav = useNavigate();
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [accounts, setAccounts] = useState<ParentAccount[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [addrMap, setAddrMap] = useState<Record<string, string>>({});
  const [loginMap, setLoginMap] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: g }, { data: p }, { data: s }] = await Promise.all([
      // ALL guardians (not just the primary) so a family's portal account is
      // found whichever parent holds it.
      supabase.from("guardians")
        .select("id, student_id, name, relationship, phone, email, sort, students ( id, first_name, last_name, archived )"),
      supabase.from("profiles")
        .select("id, full_name, email, phone, suspended, must_change_password, parent_students ( student_id, students ( first_name, last_name ) )")
        .eq("role", "parent").order("full_name"),
      supabase.from("students").select("id, first_name, last_name").eq("archived", false).order("last_name"),
    ]);
    setGuardians(((g as unknown as GuardianRow[]) ?? []).filter((r) => r.students && !r.students.archived));
    setAccounts((p as unknown as ParentAccount[]) ?? []);
    setStudents(s ?? []);
    const { data: addr } = await supabase.from("profiles")
      .select("email, address").eq("role", "parent").not("address", "is", null);
    const m: Record<string, string> = {};
    ((addr as { email: string | null; address: string | null }[]) ?? [])
      .forEach((r) => { if (r.email && r.address) m[r.email.toLowerCase()] = r.address; });
    setAddrMap(m);
    const { data: logins } = await supabase.rpc("admin_parent_logins");
    const lm: Record<string, string> = {};
    ((logins as { email: string | null; last_sign_in_at: string | null }[]) ?? [])
      .forEach((r) => { if (r.email && r.last_sign_in_at) lm[r.email.toLowerCase()] = r.last_sign_in_at; });
    setLoginMap(lm);
  }
  useEffect(() => { load(); }, []);

  const accountFor = (email: string | null | undefined) =>
    email ? accounts.find((a) => a.email?.toLowerCase() === email.toLowerCase()) : undefined;

  // One row per family. A family = a student's set of guardians; families are
  // merged when they share the same primary contact (by email, else name).
  const families = useMemo<Family[]>(() => {
    const byStudent = new Map<string, GuardianRow[]>();
    guardians.forEach((g) => byStudent.set(g.student_id, [...(byStudent.get(g.student_id) ?? []), g]));
    const fams = new Map<string, Family>();
    byStudent.forEach((gs, studentId) => {
      const sorted = [...gs].sort((a, b) => a.sort - b.sort);
      const primary = sorted[0];
      const key = (primary.email ?? primary.name).toLowerCase();
      const fam = fams.get(key) ?? { primary, members: [], kids: [] };
      sorted.forEach((g) => {
        const mk = (g.email ?? g.name).toLowerCase();
        if (!fam.members.some((m) => (m.email ?? m.name).toLowerCase() === mk)) fam.members.push(g);
      });
      fam.kids.push({ id: studentId, label: `${primary.students.first_name} ${primary.students.last_name}` });
      fams.set(key, fam);
    });
    return [...fams.values()];
  }, [guardians]);

  // The family's account = whichever member has a portal login.
  const holderOf = (f: Family) => f.members.find((m) => accountFor(m.email));

  const lastLogin = (email: string | null | undefined) => {
    const iso = email ? loginMap[email.toLowerCase()] : undefined;
    if (!iso) return { label: "never", cls: "text-gray-400" };
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const label = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    return { label, cls: days <= 7 ? "text-emerald-deep" : "text-gray-500", full: d.toLocaleString() };
  };

  const statusOf = (f: Family) => {
    const a = accountFor(holderOf(f)?.email);
    if (!a) return { label: "no account", cls: "bg-gray-200 text-gray-600", rank: 0 };
    if (a.suspended) return { label: "suspended", cls: "bg-red-100 text-red-700", rank: 1 };
    if (a.must_change_password) return { label: "invited", cls: "bg-amber-100 text-amber-800", rank: 2 };
    return { label: "active", cls: "bg-green-100 text-green-700", rank: 3 };
  };

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const list = families.filter((f) =>
      !q || f.members.some((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q))
      || f.kids.some((k) => k.label.toLowerCase().includes(q)));
    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "children": return (a.kids.length - b.kids.length) * dir;
        case "status": return (statusOf(a).rank - statusOf(b).rank) * dir;
        default: return a.primary.name.localeCompare(b.primary.name) * dir;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [families, accounts, search, sortKey, sortAsc]);

  function sortBy(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(true); }
  }
  const arrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ▲" : " ▼") : "";

  async function link(parentId: string, studentId: string) {
    const { error } = await supabase.from("parent_students").insert({ parent_id: parentId, student_id: studentId });
    if (error) setMsg("Link failed: " + error.message);
    load();
  }
  async function unlink(parentId: string, studentId: string) {
    await supabase.from("parent_students").delete().eq("parent_id", parentId).eq("student_id", studentId);
    load();
  }
  async function toggleSuspend(p: ParentAccount) {
    await supabase.from("profiles").update({ suspended: !p.suspended }).eq("id", p.id);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Parents</h1>
        <input placeholder="Search parent, email, or child…"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-royal focus:outline-none"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-silver text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("name")}>Primary Contact{arrow("name")}</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Portal login</th>
              <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("children")}>Children{arrow("children")}</th>
              <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("status")}>Account{arrow("status")}</th>
              <th className="px-4 py-3">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const st = statusOf(f);
              const holder = holderOf(f);
              const others = f.members.filter((m) => m.id !== f.primary.id);
              return (
                <tr key={f.primary.id} onClick={() => nav(`/admin/parents/${f.primary.id}`)}
                  className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/parents/${f.primary.id}`} onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-navy hover:text-royal hover:underline">{f.primary.name}</Link>
                    </div>
                    {others.map((o) => (
                      <div key={o.id} className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                        <Link to={`/admin/parents/${o.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-navy hover:underline">{o.name}</Link>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    <div>{usPhone(f.primary.phone)}</div>
                    {others.map((o) => o.phone && <div key={o.id} className="text-xs text-gray-400">{usPhone(o.phone)}</div>)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {holder ? (
                      <>
                        <div>{holder.email}</div>
                        {holder.id !== f.primary.id && <div className="text-xs text-gray-400">held by the {holder.relationship}</div>}
                        {holder.email && addrMap[holder.email.toLowerCase()] && (
                          <div className="mt-0.5 text-xs text-gray-400">🏠 {addrMap[holder.email.toLowerCase()]}</div>
                        )}
                      </>
                    ) : <span className="text-gray-400">{f.primary.email ?? "—"}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {f.kids.map((k) => (
                      <Link key={k.id} to={`/admin/students/${k.id}`} onClick={(e) => e.stopPropagation()}
                        className="mr-1.5 inline-block rounded-full bg-silver px-2.5 py-0.5 text-xs font-semibold text-navy hover:bg-navy hover:text-white">
                        {k.label}
                      </Link>
                    ))}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => { const l = lastLogin(holder?.email); return <span className={`text-xs ${l.cls}`} title={l.full ?? ""}>{l.label}</span>; })()}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !configMissing && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No parents match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold text-royal hover:underline">
          Account management tools ({accounts.length} portal account{accounts.length === 1 ? "" : "s"})
        </summary>
        <div className="mt-3 space-y-3">
          {accounts.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-navy">{p.full_name}</span>
                  <span className="ml-2 text-sm text-gray-500">{p.email}</span>
                  {p.suspended && <span className="ml-3 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Suspended</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setLinking(linking === p.id ? null : p.id)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Link child</button>
                  <button onClick={() => toggleSuspend(p)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                    {p.suspended ? "Reactivate" : "Suspend"}
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {p.parent_students.map((ps) => (
                  <span key={ps.student_id} className="flex items-center gap-1.5 rounded-full bg-silver px-3 py-1 text-xs font-semibold text-navy">
                    {ps.students.first_name} {ps.students.last_name}
                    <button onClick={() => unlink(p.id, ps.student_id)} className="text-gray-400 hover:text-red-600">✕</button>
                  </span>
                ))}
                {!p.parent_students.length && <span className="text-xs text-gray-400">No children linked.</span>}
              </div>
              {linking === p.id && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <select defaultValue="" onChange={(e) => { if (e.target.value) { link(p.id, e.target.value); setLinking(null); } }}
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="" disabled>Select a student to link…</option>
                    {students.filter((s) => !p.parent_students.some((ps) => ps.student_id === s.id))
                      .map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}
          {!accounts.length && (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
              No portal accounts yet — create them in the Supabase dashboard, then link children from each parent's profile.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
