// Build guard (President 2026-10-31): every admin menu item and every /admin route must
// belong to a staff permission module in src/lib/permissions.ts, so a new page can never
// be missing from Admin → Settings → Staff & Permissions. Runs before `npm run build`.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const perm = read("lib/permissions.ts");
const layout = read("layouts/AdminLayout.tsx");
const app = read("App.tsx");

const modules = [...perm.matchAll(/\{\s*key:\s*"([^"]+)"[^}]*?paths:\s*\[([^\]]*)\]/g)]
  .map((m) => ({ key: m[1], paths: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]) }));
const alwaysOpen = [...(perm.match(/ALWAYS_OPEN\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
const keys = new Set(modules.map((m) => m.key));
const owner = (path) => {
  let best = null, len = -1;
  for (const m of modules) for (const p of m.paths)
    if ((path === p || path.startsWith(p + "/")) && p.length > len) { best = m.key; len = p.length; }
  return best;
};

const errors = [];
// 1. menu items: { to: "/admin/x", label: "...", module: "key" | null }
for (const m of layout.matchAll(/\{\s*to:\s*"([^"]+)"[^}]*?module:\s*(null|"([^"]+)")/g)) {
  const [, to, , mod] = m;
  if (mod && !keys.has(mod)) errors.push(`menu ${to}: module "${mod}" is not in permissions.ts`);
  if (!mod && !alwaysOpen.includes(to)) errors.push(`menu ${to}: no module and not in ALWAYS_OPEN`);
  if (mod && owner(to) !== mod) errors.push(`menu ${to}: menu says "${mod}" but permissions.ts paths give "${owner(to) ?? "none"}"`);
}
// 2. routes under <Route path="/admin" ...> … </Route>
const adminBlock = app.split('<Route path="/admin"')[1]?.split("</Route>")[0] ?? "";
for (const m of adminBlock.matchAll(/<Route\s+path="([^"]+)"/g)) {
  const path = "/admin/" + m[1];
  if (!owner(path) && !alwaysOpen.includes(path)) errors.push(`route ${path}: not covered by any module's paths`);
}

if (errors.length) {
  console.error("\ncheck-modules: every admin page needs a staff permission module (src/lib/permissions.ts)\n  - " + errors.join("\n  - ") + "\n");
  process.exit(1);
}
console.log(`check-modules: ${modules.length} modules, menu and /admin routes all covered`);
