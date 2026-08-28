import { createClient } from "@supabase/supabase-js";

// The anon key is publishable by design; all protection lives in
// row-level security policies (see supabase/platform_schema.sql).
// Dev repo points at the DEV Supabase project; master at PROD.
const SUPABASE_URL = "https://xettxhdspqcgmsitlahq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dveRScv2ZdRzSw5ToLoiBg_NM9bdqjC";

export const configMissing =
  SUPABASE_URL.startsWith("REPLACE") || SUPABASE_ANON_KEY.startsWith("REPLACE");

export const supabase = createClient(
  configMissing ? "https://placeholder.supabase.co" : SUPABASE_URL,
  configMissing ? "placeholder" : SUPABASE_ANON_KEY
);
