"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { signIn } from "@/server/auth/actions";

const inputClass =
  "w-full rounded-lg border border-brand-border bg-white px-3 py-2 text-brand-ink placeholder:text-brand-muted focus:border-brand-sage-dark focus:outline-none focus:ring-1 focus:ring-brand-sage-dark";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-sage-dark px-4 py-2.5 font-medium text-white hover:bg-brand-sage disabled:opacity-50"
    >
      {pending ? "Logging in…" : "Log in"}
    </button>
  );
}

function LoginForm() {
  const [state, formAction] = useActionState(signIn, null);
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

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
            autoComplete="current-password"
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
        New to Bambini?{" "}
        <Link
          href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-brand-ink underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16 sm:py-24">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-brand-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-brand-muted">Log in to your Bambini account.</p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
