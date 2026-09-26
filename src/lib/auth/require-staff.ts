import { getAppAccess } from "./app-access";
import { createClient } from "@/lib/supabase/server";

export async function requireStaff() {
  const access = await getAppAccess();
  if (access.status !== "staff") return null;

  const supabase = await createClient();
  if (!supabase) return null;
  return { supabase, ...access };
}
