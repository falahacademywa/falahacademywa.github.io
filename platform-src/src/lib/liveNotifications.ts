// Live notifications (phase 46, President 2026-11-14): the bell updates the moment a notification
// is created, without a page refresh. Supabase Realtime on the notifications table (free plan,
// $0); the filter and RLS mean each person only ever receives their own rows.
import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

export function useLiveNotifications<T extends { id: number }>(userId: string | undefined, onNew: (row: T) => void) {
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (p) => cb.current(p.new as T))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);
}

/** Prepend a new row to a list, skipping duplicates and keeping it at most `max` long. */
export function prependUnique<T extends { id: number }>(list: T[], row: T, max = 30): T[] {
  return list.some((x) => x.id === row.id) ? list : [row, ...list].slice(0, max);
}
