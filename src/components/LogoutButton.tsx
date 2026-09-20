"use client";

import { useTransition } from "react";
import { signOut } from "@/server/auth/actions";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => signOut())}
      className="text-sm font-medium text-brand-ink underline decoration-brand-border underline-offset-4 hover:decoration-brand-ink disabled:opacity-50"
    >
      {isPending ? "Logging out…" : "Log out"}
    </button>
  );
}
