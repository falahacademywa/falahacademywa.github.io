// Supabase Edge Function: create-parent
// Creates a parent auth user + profile with a temporary password (BR-011..BR-014).
// Deploy: supabase functions deploy create-parent
// Requires (set automatically in the Edge runtime): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Called by the admin portal with the admin's JWT; verifies the caller is an admin.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // Verify the caller is a signed-in admin.
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response("Unauthorized", { status: 401, headers: cors });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return new Response("Unauthorized", { status: 401, headers: cors });
  const { data: prof } = await admin
    .from("profiles").select("role").eq("id", caller.user.id).single();
  if (prof?.role !== "admin")
    return new Response("Admins only", { status: 403, headers: cors });

  const { email, full_name, phone } = await req.json();
  if (!email || !full_name)
    return new Response("email and full_name required", { status: 400, headers: cors });

  // Temporary password; parent must change it at first login (BR-014).
  const tempPassword = crypto.randomUUID().slice(0, 12);

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) return new Response(error.message, { status: 400, headers: cors });

  await admin.from("profiles")
    .update({ full_name, phone: phone ?? null, role: "parent" })
    .eq("id", created.user.id);

  await admin.from("audit_log").insert({
    actor: caller.user.id,
    action: "create_parent",
    entity: "profile",
    entity_id: created.user.id,
    new_value: { email, full_name },
  });

  // Return the temp password so the admin can print Orientation Day instructions (BR-013).
  return new Response(
    JSON.stringify({ id: created.user.id, email, temp_password: tempPassword }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
