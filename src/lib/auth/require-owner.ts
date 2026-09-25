import { getOwnerAccess } from "@/lib/auth/owner-access";
import { createClient } from "@/lib/supabase/server";

export async function requireOwnerClient() {
  const access = await getOwnerAccess();
  if (access.status !== "owner") return null;
  const supabase = await createClient();
  if (!supabase) return null;
  return { supabase, ownerId: access.ownerId, email: access.email };
}
