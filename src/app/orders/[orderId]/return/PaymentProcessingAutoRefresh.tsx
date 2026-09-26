"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Only ever rendered while payment_status is neither 'paid' nor 'failed'
 * (see page.tsx) — periodically re-fetches this same server-rendered
 * page so a buyer waiting here sees the confirmed/failed result as soon
 * as the verified PayFast ITN lands, without needing to tap "Refresh"
 * themselves. This never reads or trusts anything client-side about
 * payment state; router.refresh() only re-runs the page's own
 * server-side getOrder() call, the same authoritative read a manual
 * refresh would trigger.
 */
export function PaymentProcessingAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [router]);
  return null;
}
