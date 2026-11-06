// Supabase Edge Function: social-post (phase 36, TODO #110)
// Posts one queued post to the Facebook page and/or the Instagram account, or (cron mode)
// every scheduled post that is due.
//
//   POST { "post_id": 123 }   with the signed-in user's JWT -> posts that one post, if
//                             social_can_post() allows the caller (President/admins; staff with
//                             edit on 'social' only for the unplanned-closure posts T6).
//   POST { "run_due": true }  with the project's SERVICE key as Bearer -> posts every
//                             status='scheduled' post whose scheduled_at has passed.
//
// Secrets (Supabase -> Edge Functions -> Secrets, set by the President; never in files):
//   FB_PAGE_TOKEN  never-expiring Page token (pages_manage_posts + instagram_content_publish)
//   FB_PAGE_ID     665430716656255
//   IG_USER_ID     17841442664472826
// Automatic in the Edge runtime: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// DEV project (or SOCIAL_TEST_MODE=1): nothing is published. Facebook gets an UNPUBLISHED post
// that is deleted again at once; Instagram gets a media container that is never published.
// Deploy with JWT verification OFF (the function checks the caller itself):
//   supabase functions deploy social-post --no-verify-jwt

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const G = "https://graph.facebook.com/v27.0";
const DEV_REF = "rlaqpzeqmmlrdeqfbjyq";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Post {
  id: number; body: string; platforms: string[]; card_url: string | null; image_url: string | null;
  image_no_children: boolean; status: string; template_key: string | null;
  fb_post_id: string | null; ig_media_id: string | null; ig_permalink: string | null;
}
// only our own files may be posted: drawn cards and uploads in the public `social` bucket (phase 39)
const OWN_FILE = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/social\//;

async function graph(path: string, params: Record<string, string>, method = "POST") {
  const token = Deno.env.get("FB_PAGE_TOKEN")!;
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET"
    ? await fetch(`${G}/${path}?${body}`)
    : await fetch(`${G}/${path}`, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`${path}: ${data.error?.message ?? res.status}`);
  return data;
}

async function postOne(db: SupabaseClient, id: number, userId: string | null, test: boolean) {
  const { data: claimed, error: ce } = await db.rpc("social_claim", { p_id: id });
  if (ce) throw new Error(ce.message);
  if (!claimed) return { id, skipped: "already posting or posted" };
  const { data: p } = await db.from("social_posts").select("*").eq("id", id).single<Post>();
  const result: Record<string, string | null> = { fb_post_id: null, ig_media_id: null, ig_permalink: null };
  try {
    if (!p) throw new Error("post not found");
    // a retry after a partial failure must not post again where it already went out (phase 39)
    result.fb_post_id = p.fb_post_id; result.ig_media_id = p.ig_media_id; result.ig_permalink = p.ig_permalink;
    if (!p.body.trim()) throw new Error("the post has no text");
    if (/\{[a-z_]+\}/.test(p.body)) throw new Error("fill in every {placeholder} first");
    if (p.image_url && !p.image_no_children) throw new Error("uploaded image is not confirmed as free of children");
    const image = p.image_url ?? p.card_url;
    if (image && !OWN_FILE.test(image)) throw new Error("the image must be a card drawn in the portal or an upload made there");
    const page = Deno.env.get("FB_PAGE_ID")!, ig = Deno.env.get("IG_USER_ID");
    if (p.platforms.includes("facebook") && !(result.fb_post_id && !test)) {
      const r = image
        ? await graph(`${page}/photos`, { url: image, caption: p.body, published: test ? "false" : "true" })
        : await graph(`${page}/feed`, { message: p.body, published: test ? "false" : "true" });
      result.fb_post_id = r.post_id ?? r.id;
      if (test) await graph(String(r.id), {}, "DELETE").catch(() => null);   // dev: remove the hidden test post
    }
    if (p.platforms.includes("instagram") && !(result.ig_media_id && !test)) {
      if (!ig) throw new Error("IG_USER_ID secret is not set");
      if (!image) throw new Error("Instagram needs an image: prepare the card first");
      const c = await graph(`${ig}/media`, { image_url: image, caption: p.body });
      if (test) {
        result.ig_media_id = `test-container-${c.id}`;   // dev: container only, never published
      } else {
        for (let i = 0; i < 15; i++) {
          const s = await graph(String(c.id), { fields: "status_code" }, "GET");
          if (s.status_code === "FINISHED") break;
          if (s.status_code === "ERROR") throw new Error("Instagram could not process the image");
          await new Promise((r) => setTimeout(r, 2000));
        }
        const m = await graph(`${ig}/media_publish`, { creation_id: String(c.id) });
        result.ig_media_id = m.id;
        const l = await graph(String(m.id), { fields: "permalink" }, "GET").catch(() => ({}));
        result.ig_permalink = (l as { permalink?: string }).permalink ?? null;
      }
    }
    await db.from("social_posts").update({
      ...result, status: "posted", error: null, test_run: test, posted_at: new Date().toISOString(), posted_by: userId,
    }).eq("id", id);
    return { id, ok: true, test, ...result };
  } catch (e) {
    const msg = (e as Error).message;
    // keep whatever already went out, so a retry does not post twice to the same platform
    const done = [result.fb_post_id && "Facebook already posted", result.ig_media_id && "Instagram already posted"].filter(Boolean).join(", ");
    await db.from("social_posts").update({
      status: "failed", error: msg + (done ? ` (${done}; a retry posts only the rest)` : ""),
      fb_post_id: result.fb_post_id, ig_media_id: result.ig_media_id, ig_permalink: result.ig_permalink, test_run: test,
    }).eq("id", id);
    return { id, ok: false, error: msg + done };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const test = url.includes(DEV_REF) || Deno.env.get("SOCIAL_TEST_MODE") === "1";
  if (!Deno.env.get("FB_PAGE_TOKEN") || !Deno.env.get("FB_PAGE_ID")) return json({ error: "FB_PAGE_TOKEN / FB_PAGE_ID secrets are not set" }, 500);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));

  // cron mode: the bearer must be a service key (only the service role may claim posts)
  if (body.run_due) {
    const db = createClient(url, bearer, { auth: { persistSession: false } });
    const { data, error } = await db.from("social_posts").select("id")
      .eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(10);
    if (error) return json({ error: "Unauthorized" }, 401);
    const out = [];
    for (const r of data ?? []) out.push(await postOne(db, r.id, null, test));
    await db.rpc("social_purge_old");
    return json({ test, posted: out });
  }

  // user mode: check the caller with their own key, then post with the service role
  const id = Number(body.post_id);
  if (!id) return json({ error: "post_id required" }, 400);
  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false },
  });
  const { data: u } = await userDb.auth.getUser(bearer);
  if (!u?.user) return json({ error: "Unauthorized" }, 401);
  const { data: allowed, error: pe } = await userDb.rpc("social_can_post", { p_id: id });
  if (pe || !allowed) return json({ error: "Only the President or an admin can post this (staff: unplanned-closure posts only)." }, 403);
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const r = await postOne(db, id, u.user.id, test);
    return json(r, r.ok === false ? 502 : 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
