import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PayFastProvider, isValidPayFastSenderHost } from "@/server/payments/providers/payfast/payfast";
import { bookDeliveryForOrder } from "@/server/delivery/bookingService";

export const dynamic = "force-dynamic";

/**
 * Server-to-server only — PayFast, not a signed-in browser, calls this.
 * There is no Supabase session/cookie to check; authenticity comes
 * entirely from PayFast's own protocol (signature + host + the
 * /eng/query/validate server confirmation, all inside
 * PayFastProvider.verifyWebhook()/isValidPayFastSenderHost()), never
 * from "the request reached this URL." The actual DB write happens in
 * process_payfast_itn(), whose EXECUTE grant is restricted to
 * service_role — this route is the only application-level caller,
 * using the admin client (the one place in this codebase that's the
 * correct, intended use of it: an operation that has already done its
 * own authorization/authenticity check server-side, per
 * src/lib/supabase/admin.ts's own doc comment).
 *
 * The raw body is read as text and never re-parsed through a
 * form-data/object round-trip before signature verification — doing
 * that could reorder or re-encode fields, which would silently break
 * the signature check (see signature.ts) since PayFast's ITN signature
 * must be verified against the *exact* posted field order.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();

    const provider = new PayFastProvider();
    const result = await provider.verifyWebhook(rawBody, null);

    if (!result.valid) {
      console.error(`PayFast ITN rejected: ${result.reason}`);
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    // Host/referer check — PayFast's own documented mechanism, and the
    // weakest of the checks performed (a header value, not a
    // cryptographic proof) — see isValidPayFastSenderHost()'s own doc
    // comment. Signature verification and the query/validate call above
    // are the real trust anchors; this is additional-but-not-primary.
    const senderHost = request.headers.get("referer") ?? request.headers.get("origin");
    if (!isValidPayFastSenderHost(senderHost)) {
      console.error(`PayFast ITN rejected: unrecognized sender host "${senderHost ?? "(none)"}"`);
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    if (!isUuid(result.merchantReference)) {
      console.error("PayFast ITN rejected: merchant reference is not a recognizable order id");
      return NextResponse.json({ error: "unknown order" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("process_payfast_itn", {
      p_order_id: result.merchantReference,
      p_provider_reference: result.providerReference,
      p_status: result.status,
      p_amount_cents: result.amountCents,
    });

    if (error || !data || data.length === 0) {
      console.error(`PayFast ITN processing failed for order ${result.merchantReference}.`);
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }

    const outcome = data[0].outcome;
    if (
      outcome === "rejected_not_found" ||
      outcome === "rejected_amount_mismatch" ||
      outcome === "rejected_invalid_status"
    ) {
      console.error(`PayFast ITN rejected for order ${result.merchantReference}: ${outcome}`);
      return NextResponse.json({ error: outcome }, { status: 400 });
    }

    // Phase 7A: book the delivery once payment is confirmed — never
    // before. Triggered on "duplicate_ignored" too, not just
    // "confirmed": a PayFast retry of an already-paid order is exactly
    // how a crashed/interrupted first booking attempt gets a second
    // chance (see bookDeliveryForOrder()'s own doc comment for why).
    // bookDeliveryForOrder() itself is a no-op for a collection order
    // or an order that's already booked, so this is safe to call
    // unconditionally here. Never allowed to fail the webhook response
    // — PayFast only cares that its payment notification was received;
    // a delivery-booking problem is logged and handled as its own
    // concern, not surfaced as a payment processing failure.
    if (outcome === "confirmed" || outcome === "duplicate_ignored") {
      try {
        await bookDeliveryForOrder(result.merchantReference);
      } catch (err) {
        console.error(`PayFast webhook: bookDeliveryForOrder threw for order ${result.merchantReference}: ${(err as Error).message}`);
      }
    }

    // "confirmed" | "failed_recorded" | "duplicate_ignored" — all
    // legitimate, safe-to-acknowledge outcomes; PayFast expects a 200
    // within 10 seconds or it will keep retrying.
    return NextResponse.json({ received: true, outcome });
  } catch {
    // Catches, among other things, PayFast not being configured at all
    // (getPayFastCredentials() throws if PAYFAST_MERCHANT_ID/KEY are
    // unset) — this route is PayFast-specific, so it always constructs
    // a PayFastProvider regardless of which provider PAYMENT_PROVIDER
    // currently selects. Never let an unexpected error surface as an
    // unhandled crash/stack trace; always a clean, generic response.
    console.error("PayFast webhook processing threw an unexpected error.");
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
