"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

export function createClient() {
  const env = getSupabaseEnv();
  if (!env.configured || !env.url || !env.publishableKey) return null;

  return createBrowserClient(env.url, env.publishableKey);
}
