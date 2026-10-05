"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { confirmPhoneVerification, resendPhoneVerification, startPhoneVerification } from "@/server/phone/actions";
import { formatPhoneForDisplay } from "@/server/phone/normalizePhone";
import { PHONE_LIMITS, type PhoneVerificationState } from "@/server/phone/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { inputVariants } from "@/lib/ui/variants";

type Props = {
  /** From Supabase Auth's phone_confirmed_at, via the server — the ONLY thing that makes this UI say "verified". */
  phoneConfirmed: boolean;
  /** The Auth phone (E.164) — confirmed only when phoneConfirmed. */
  authPhone: string | null;
  /** Auth's pending new_phone (E.164): a number that has been sent a code but is NOT yet verified. */
  pendingPhone: string | null;
  /** Remaining resend cooldown at page load, in seconds (0 = may resend now). */
  initialCooldownSeconds: number;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" fullWidth loading={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * A button that is disabled until `seconds` have elapsed. Remount it with
 * a new `key` to restart the countdown (the parent keys it on the latest
 * server response, so the timer always reflects the server's cooldown,
 * not a client guess).
 */
function ResendButton({ seconds }: { seconds: number }) {
  const { pending } = useFormStatus();
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Button type="submit" variant="outline" size="sm" loading={pending} disabled={left > 0}>
      {left > 0 ? `Resend code in ${left}s` : "Resend code"}
    </Button>
  );
}

function minutesLabel(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "about a minute" : `about ${m} minutes`;
}

function StateAlert({ state }: { state: PhoneVerificationState }) {
  if (!state) return null;
  // "verified" is deliberately NOT announced from an action result: the
  // verified message only ever comes from server-confirmed Auth props.
  if (state.status === "verified" || state.status === "code_sent") return null;
  if (state.status === "rate_limited") {
    return <Alert tone="danger">{state.message} Try again in {minutesLabel(state.retryAfterSeconds)}.</Alert>;
  }
  if (state.status === "already_verified") return <Alert tone="info">{state.message}</Alert>;
  return <Alert tone="danger">{state.message}</Alert>;
}

/**
 * The phone-verification flow, shown only when PHONE_VERIFICATION_ENABLED
 * (an SMS provider is connected). Every claim of "verified" derives from
 * the `phoneConfirmed` prop — Supabase Auth's phone_confirmed_at as read
 * on the server — never from a button click or an action result.
 *
 * A verified user switching numbers keeps their current verified number
 * until the new one passes its own code check (Auth only swaps it in
 * then), so the UI shows both states plainly.
 */
export function PhoneVerification({ phoneConfirmed, authPhone, pendingPhone, initialCooldownSeconds }: Props) {
  const [startState, startAction] = useActionState(startPhoneVerification, null);
  const [confirmState, confirmAction] = useActionState(confirmPhoneVerification, null);
  const [resendState, resendAction] = useActionState(resendPhoneVerification, null);
  const [changing, setChanging] = useState(false);

  // The cooldown always follows the most recent server response that carried one.
  const timed = [startState, resendState].filter((s): s is Extract<NonNullable<PhoneVerificationState>, { at: number }> => s != null && "at" in s);
  const latest = timed.sort((a, b) => b.at - a.at)[0];
  const cooldownSeconds = latest ? latest.retryAfterSeconds : initialCooldownSeconds;
  const cooldownKey = latest ? latest.at : 0;

  const showCodeEntry = pendingPhone != null && !changing;
  const showNumberEntry = !showCodeEntry && (!phoneConfirmed || changing || startState?.status === "error");

  return (
    <div className="flex flex-col gap-3 border-t border-brand-light-sage pt-3">
      {phoneConfirmed && authPhone && (
        <p className="text-body-small text-brand-ink">
          Verified number: <span className="font-medium">{formatPhoneForDisplay(authPhone)}</span>
        </p>
      )}

      {showCodeEntry && (
        <div className="flex flex-col gap-3">
          <p className="text-body-small text-brand-ink">
            We sent a {PHONE_LIMITS.otpLength}-digit code by SMS to <span className="font-medium">{formatPhoneForDisplay(pendingPhone)}</span>.
            {phoneConfirmed && " Your current verified number stays in place until this one is confirmed."}
          </p>

          <form action={confirmAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="phone-code" className="text-body-small font-medium text-brand-ink">
                Verification code
              </label>
              <input
                id="phone-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={`\\d{${PHONE_LIMITS.otpLength}}`}
                maxLength={PHONE_LIMITS.otpLength}
                placeholder={`${PHONE_LIMITS.otpLength} digits`}
                required
                className={inputVariants()}
              />
            </div>
            <StateAlert state={confirmState} />
            <SubmitButton label="Verify phone" pendingLabel="Verifying…" />
          </form>

          <div className="flex flex-wrap items-center gap-3">
            <form action={resendAction}>
              <ResendButton key={cooldownKey} seconds={cooldownSeconds} />
            </form>
            <button type="button" onClick={() => setChanging(true)} className="text-body-small font-medium text-bambini-forest hover:underline">
              Use a different number
            </button>
          </div>
          <StateAlert state={resendState} />
          {resendState?.status === "code_sent" && <Alert tone="info">{resendState.message}</Alert>}
        </div>
      )}

      {showNumberEntry && (
        <form
          action={(formData) => {
            setChanging(false);
            startAction(formData);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="phone-number" className="text-body-small font-medium text-brand-ink">
              {phoneConfirmed ? "New South African mobile number" : "South African mobile number"}
            </label>
            <input
              id="phone-number"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              maxLength={32}
              required
              className={inputVariants()}
            />
            <p className="text-caption text-brand-muted">
              We&apos;ll text you a code. {phoneConfirmed ? "Your number only changes once you confirm the new one." : "Standard SMS rates may apply."}
            </p>
          </div>
          <StateAlert state={startState} />
          <SubmitButton label="Send code" pendingLabel="Sending…" />
          {changing && (
            <button type="button" onClick={() => setChanging(false)} className="self-start text-body-small font-medium text-bambini-forest hover:underline">
              {pendingPhone != null ? "Back to code entry" : "Cancel"}
            </button>
          )}
        </form>
      )}

      {!showCodeEntry && !showNumberEntry && (
        <button type="button" onClick={() => setChanging(true)} className="self-start text-body-small font-medium text-bambini-forest hover:underline">
          Change number
        </button>
      )}
    </div>
  );
}
