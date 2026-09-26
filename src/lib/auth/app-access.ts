import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getOwnerAccess, type OwnerAccess } from "./owner-access";

export type AppAccess =
  | Exclude<OwnerAccess, { status: "not-owner" }>
  | { status: "not-authorized" }
  | { status: "staff"; ownerId: string; email: string; membershipId: string; displayName: string };

export const getAppAccess = cache(async (): Promise<AppAccess> => {
  const ownerAccess = await getOwnerAccess();
  if (ownerAccess.status !== "not-owner") return ownerAccess;

  const supabase = await createClient();
  if (!supabase) return { status: "unconfigured" };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const subject = claimsData?.claims?.sub;
  if (claimsError || !claimsData || typeof subject !== "string") return { status: "signed-out" };

  const { data: membership, error } = await supabase
    .from("store_memberships")
    .select("id,owner_id,email,display_name")
    .eq("user_id", subject)
    .eq("active", true)
    .maybeSingle();

  if (error) return { status: "unavailable" };
  if (!membership) return { status: "not-authorized" };

  return {
    status: "staff",
    ownerId: membership.owner_id,
    email: membership.email,
    membershipId: membership.id,
    displayName: membership.display_name,
  };
});
