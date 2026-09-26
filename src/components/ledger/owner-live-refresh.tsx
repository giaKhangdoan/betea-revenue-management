"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the owner day view while it is visible so staff uploads appear promptly. */
export function OwnerLiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [router]);

  return null;
}
