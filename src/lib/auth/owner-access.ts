import { createClient } from "@/lib/supabase/server";

export type OwnerAccess =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "not-owner" }
  | { status: "unavailable" }
  | { status: "owner"; email: string | null; ownerId: string };

export async function getOwnerAccess(): Promise<OwnerAccess> {
  const supabase = await createClient();
  if (!supabase) return { status: "unconfigured" };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const subject = claimsData?.claims?.sub;
  if (claimsError || !claimsData || typeof subject !== "string") return { status: "signed-out" };

  const { data: profile, error } = await supabase
    .from("owner_profiles")
    .select("user_id")
    .eq("user_id", subject)
    .maybeSingle();

  if (error) return { status: "unavailable" };
  if (!profile) return { status: "not-owner" };

  const email = claimsData.claims.email;
  return {
    status: "owner",
    ownerId: subject,
    email: typeof email === "string" ? email : null,
  };
}
