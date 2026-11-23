// Supabase Edge Function: push-send (phase 48, President 2026-11-22)
// Sends one portal notification to the phones and browsers its recipient has switched on
// (Web Push), so an alert arrives even when the portal is closed. $0: the push services belong to
// the browser makers (Google, Apple, Mozilla) and are free; this function runs on the free tier.
//
//   POST { "id": 123 }     from the database (trigger notification_push, pg_net): push
//                          notification 123. A notification is pushed once only: the function
//                          first claims it (pushed_at) and does nothing if it was already claimed
//                          or is older than ten minutes. So calling this with any number can only
//                          ever send an alert that was about to be sent anyway.
//   GET  ?init=1           one-time setup, safe to repeat: creates the signing key pair if there
//                          is none and stores this function's own address in app_settings.push_url
//                          (the trigger reads it from there).
//
// No secrets to set. The signing key pair (VAPID) is generated here on the first run and kept in
// public.push_config, which only the service role can read; the public half is what browsers get
// when they subscribe (push_public_key()). Automatic in the Edge runtime: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
// Deploy with JWT verification OFF (the database calls it without a user):
//   supabase functions deploy push-send --no-verify-jwt

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CONTACT = "mailto:falahacademywa@gmail.com";   // who a push service may write to about this sender
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------------- small byte helpers ----------------
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

// ---------------- Web Push (RFC 8291 message encryption, RFC 8292 VAPID) ----------------
// The message is encrypted for the one browser it goes to; the push service cannot read it.
export async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const ephPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, ephPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // one record: the text, then the 0x02 "last record" marker
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(16 + 4 + 1 + ephPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = ephPublic.length;
  head.set(ephPublic, 21);
  return concat(head, cipher);
}

export async function vapidAuthorization(endpoint: string, publicKey: string, privateJwk: JsonWebKey): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT,
  })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

interface Config { public_key: string; private_jwk: JsonWebKey }
interface Sub { id: number; endpoint: string; p256dh: string; auth: string; fails: number }

// the key pair: read it, or create it on the very first run (a second caller racing us keeps the first one's)
async function config(db: SupabaseClient, create: boolean): Promise<Config | null> {
  const read = async () => (await db.from("push_config").select("public_key, private_jwk").eq("id", 1).maybeSingle<Config>()).data;
  const have = await read();
  if (have || !create) return have ?? null;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const public_key = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
  const private_jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  await db.from("push_config").upsert({ id: 1, public_key, private_jwk }, { onConflict: "id", ignoreDuplicates: true });
  return await read();
}

// Only the browser makers' own push services are ever posted to (same rule as push_subscribe()).
function isPushService(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const h = u.hostname;
    return u.protocol === "https:" && (h === "fcm.googleapis.com" || h === "android.googleapis.com"
      || h.endsWith(".push.services.mozilla.com") || h.endsWith(".notify.windows.com") || h.endsWith(".push.apple.com"));
  } catch { return false; }
}

async function sendOne(db: SupabaseClient, cfg: Config, s: Sub, payload: string): Promise<boolean> {
  try {
    if (!isPushService(s.endpoint)) { await db.from("push_subscriptions").delete().eq("id", s.id); return false; }
    const body = await encryptPayload(payload, s.p256dh, s.auth);
    const res = await fetch(s.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(s.endpoint, cfg.public_key, cfg.private_jwk),
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        TTL: "86400", Urgency: "high",
      },
      body,
    });
    await res.body?.cancel();
    if (res.ok) {
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq("id", s.id);
      return true;
    }
    // the device is gone (app removed, permission withdrawn) or was subscribed with another key: forget it
    if ([403, 404, 410].includes(res.status) || s.fails >= 20) await db.from("push_subscriptions").delete().eq("id", s.id);
    else await db.from("push_subscriptions").update({ fails: s.fails + 1 }).eq("id", s.id);
    console.log(`push ${s.id}: ${res.status}`);
    return false;
  } catch (e) {
    console.log(`push ${s.id}: ${(e as Error).message}`);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const q = new URL(req.url).searchParams;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (q.get("init") || body.init) {
      const cfg = await config(db, true);
      if (!cfg) return json({ ok: false, error: "could not create the signing key (has phase 48 been run?)" }, 500);
      const { error } = await db.from("app_settings").upsert({ key: "push_url", value: `${url}/functions/v1/push-send` }, { onConflict: "key" });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, ready: true });
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "id required" }, 400);

    // claim it: not pushed before, and fresh
    const { data: claimed } = await db.from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .eq("id", id).is("pushed_at", null).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .select("id, recipient_id, title, message, link_path");
    const n = claimed?.[0];
    if (!n) return json({ ok: true, sent: 0, skipped: true });

    const cfg = await config(db, false);
    if (!cfg) return json({ ok: true, sent: 0, skipped: "not set up" });
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, fails").eq("user_id", n.recipient_id);
    const payload = JSON.stringify({
      id: n.id, title: String(n.title ?? "Falah Academy").slice(0, 120),
      body: String(n.message ?? "").slice(0, 600), url: n.link_path ?? "",
    });
    const results = await Promise.all(((subs as Sub[] | null) ?? []).map((s) => sendOne(db, cfg, s, payload)));
    return json({ ok: true, sent: results.filter(Boolean).length, devices: results.length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
