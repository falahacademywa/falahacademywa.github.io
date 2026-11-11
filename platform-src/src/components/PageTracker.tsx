import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase, configMissing } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// Activity Log (phase 42): staff, admins and teachers log the pages they open (parents already
// log their own portal events). One row per page, at most once a minute for the same page.
export default function PageTracker() {
  const loc = useLocation();
  const { profile } = useAuth();
  const last = useRef<{ path: string; at: number }>({ path: "", at: 0 });
  useEffect(() => {
    if (configMissing || !profile || profile.role === "parent") return;
    const path = loc.pathname;
    if (path === "/login" || path.startsWith("/meet")) return;
    const now = Date.now();
    if (last.current.path === path && now - last.current.at < 60_000) return;
    last.current = { path, at: now };
    supabase.from("portal_events").insert({ user_id: profile.id, event: "page", detail: path }).then(() => {});
  }, [loc.pathname, profile?.id]);
  return null;
}
