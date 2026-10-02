"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/browser";

const METADATA_POLL_INTERVAL_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 700;
const LIVE_TABLES = ["day_photos", "daily_records", "daily_expenses"] as const;

type OwnerLiveRefreshProps = {
  ownerId: string;
  date: string;
};

function belongsToOwner(value: unknown, ownerId: string) {
  if (!value || typeof value !== "object") return true;
  const rowOwnerId = (value as { owner_id?: unknown }).owner_id;
  return rowOwnerId === undefined || rowOwnerId === ownerId;
}

/** Updates the visible owner day view only when its underlying rows change. */
export function OwnerLiveRefresh({ ownerId, date }: OwnerLiveRefreshProps) {
  const router = useRouter();
  const signatureRef = useRef<string | null>(null);

  useEffect(() => {
    const client = createBrowserClient();
    if (!client) return;

    let stopped = false;
    let pollTimer: number | undefined;
    let refreshTimer: number | undefined;
    signatureRef.current = null;

    const clearTimers = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      pollTimer = undefined;
      refreshTimer = undefined;
    };

    const scheduleRefresh = () => {
      // A Realtime event tells us that the server page is stale. Resetting the
      // signature prevents the fallback poll from refreshing the same change again.
      signatureRef.current = null;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        if (!stopped && document.visibilityState === "visible") router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const readSignature = async () => {
      if (stopped || document.visibilityState !== "visible") return;

      const [photosResult, recordsResult, expensesResult] = await Promise.all([
        client.from("day_photos").select("id,created_at").eq("owner_id", ownerId).eq("business_date", date).order("created_at", { ascending: true }),
        client.from("daily_records").select("id,updated_at").eq("owner_id", ownerId).eq("business_date", date),
        client.from("daily_expenses").select("id,created_at,deleted_at").eq("owner_id", ownerId).eq("business_date", date).order("created_at", { ascending: true }),
      ]);

      if (stopped || photosResult.error || recordsResult.error || expensesResult.error) return;

      const nextSignature = JSON.stringify({
        photos: photosResult.data ?? [],
        records: recordsResult.data ?? [],
        expenses: expensesResult.data ?? [],
      });
      if (signatureRef.current === null) {
        signatureRef.current = nextSignature;
        return;
      }
      if (signatureRef.current !== nextSignature) {
        signatureRef.current = nextSignature;
        scheduleRefresh();
      }
    };

    const startPolling = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      pollTimer = undefined;
      if (document.visibilityState !== "visible") return;
      void readSignature();
      pollTimer = window.setInterval(() => void readSignature(), METADATA_POLL_INTERVAL_MS);
    };

    let channel = client.channel(`owner-day-${ownerId}-${date}`);
    for (const table of LIVE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `business_date=eq.${date}` },
        (payload) => {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          if (belongsToOwner(row, ownerId)) scheduleRefresh();
        },
      );
    }
    void channel.subscribe();

    startPolling();
    document.addEventListener("visibilitychange", startPolling);

    return () => {
      stopped = true;
      clearTimers();
      document.removeEventListener("visibilitychange", startPolling);
      void client.removeChannel(channel);
    };
  }, [date, ownerId, router]);

  return null;
}
