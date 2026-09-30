"use client";

import Link from "next/link";
import { Suspense, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { signUp } from "@/server/auth/actions";
import { PASSWORD_MIN_LENGTH, checkPasswordStrength } from "@/server/auth/validation";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

/**
 * Renders straight from checkPasswordStrength() — the same function
 * passwordSchema (src/server/auth/validation.ts) uses server-side — so
 * the rules shown here can never drift from what's actually enforced.
 * Only appears once the user has started typing a password; empty-field
 * noise before that isn't useful feedback.
 */
function PasswordChecklist({ password }: { password: string }) {
  if (password.length === 0) return null;
  const { requirements } = checkPasswordStrength(password);

  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {requirements.map((r) => (
        <li key={r.id} className={r.met ? "text-green-700" : "text-brand-muted"}>
          {r.met ? "✓" : "○"} {r.label.charAt(0).toUpperCase() + r.label.slice(1)}
        </li>
      ))}
    </ul>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Creating your account…" : "Create account"}
    </button>
  );
}

function SignUpForm() {
  const [state, formAction] = useActionState(signUp, null);
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const [password, setPassword] = useState("");

  if (state && "confirmationSent" in state) {
    return (
      <p role="status" className="rounded-lg bg-brand-sage/20 px-3 py-3 text-sm text-brand-ink">
        Check your email to confirm your account before signing in. You&apos;ll be able to browse right away, but buying and
        selling need a confirmed email.
      </p>
    );
  }

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <div className="flex flex-col gap-1">
          <label htmlFor="fullName" className="text-sm font-medium text-brand-ink">
            Full name
          </label>
          <input id="fullName" name="fullName" type="text" autoComplete="name" required className={inputClass} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-brand-ink">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-brand-ink">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <PasswordChecklist password={password} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-brand-ink">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            className={inputClass}
          />
        </div>

        {state?.error && (
          <p role="alert" className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
            {state.error}
          </p>
        )}

        <SubmitButton />
      </form>

      <p className="text-center text-sm text-brand-muted">
        Already have an account?{" "}
        <Link
          href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-brand-ink underline"
        >
          Log in
        </Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16 sm:py-24">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-brand-ink">Create your account</h1>
        <p className="mt-1 text-sm text-brand-muted">Buy and sell baby and kids products near you.</p>
      </div>
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
