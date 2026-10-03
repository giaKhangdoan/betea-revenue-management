import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createR2ReadUrl } from "./r2";

type EvidencePhoto = { object_path: string; storage_provider: string | null };

export async function createEvidencePhotoUrl(supabase: SupabaseClient, photo: EvidencePhoto) {
  if (photo.storage_provider === "r2") {
    const r2Url = await createR2ReadUrl(photo.object_path);
    if (r2Url) return r2Url;
  }

  const { data, error } = await supabase.storage.from("betea-evidence").createSignedUrl(photo.object_path, 300);
  return error ? null : data?.signedUrl ?? null;
}
