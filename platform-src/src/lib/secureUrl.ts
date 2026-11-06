// Private child photos (phase 39, 2026-11-05): the student-photos and class-updates buckets are no
// longer public. Old rows still hold the public-style link ".../object/public/<bucket>/<path>", so
// these helpers turn such a link into a short-lived signed link (the storage policies decide who may
// open it). Any other link (Google Drive, teacher photos, social cards) is returned unchanged.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const PRIVATE = /\/storage\/v1\/object\/(?:public|sign)\/(student-photos|class-updates)\/([^?]+)/;
const cache = new Map<string, { url: string; until: number }>();
const pending = new Map<string, Promise<string | null>>();

export function isPrivatePhoto(url: string | null | undefined) { return !!url && PRIVATE.test(url); }

/** Signed link for a private photo (cached ~50 min), or the link itself when it is not private. */
export async function signedUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const m = url.match(PRIVATE);
  if (!m) return url;
  const key = `${m[1]}/${m[2]}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  if (pending.has(key)) return pending.get(key)!;
  const p = supabase.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 3600).then(({ data }) => {
    pending.delete(key);
    if (!data?.signedUrl) return null;
    cache.set(key, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  });
  pending.set(key, p);
  return p;
}

/** React hook: the displayable link for a stored photo link (null while signing or when not allowed). */
export function useSignedUrl(url: string | null | undefined): string | null {
  const [out, setOut] = useState<string | null>(() => (url && !isPrivatePhoto(url) ? url : null));
  useEffect(() => {
    let live = true;
    if (!url) { setOut(null); return; }
    if (!isPrivatePhoto(url)) { setOut(url); return; }
    signedUrl(url).then((u) => { if (live) setOut(u); });
    return () => { live = false; };
  }, [url]);
  return out;
}
