"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "@/components/ui/icons";
import { saveListing, unsaveListing } from "@/server/favourites/actions";

type Variant = "overlay" | "inline" | "remove";

/**
 * The one favourite mechanism — ProductCard, the listing detail page, and
 * the saved-items page all render this same component, so save/unsave
 * logic exists exactly once. It never decides ownership or eligibility:
 * both server actions derive the user themselves, and the database
 * (product_favourites' owner policy + composite primary key) is
 * authoritative. The optimistic flip is purely cosmetic and is reverted,
 * with a visible message, whenever the server says otherwise.
 *
 * Signed-out visitors see the heart too, but pressing it sends them to
 * sign in and returns them to this page — nothing is stored for them.
 * State is conveyed by the icon's fill AND the accessible name/pressed
 * state (and visible text in the inline variant), never by colour alone.
 */
export function FavoriteButton({
  productId,
  title,
  initiallySaved,
  signedIn,
  variant = "overlay",
  refreshOnChange = false,
}: {
  productId: string;
  title: string;
  initiallySaved: boolean;
  signedIn: boolean;
  variant?: Variant;
  /** Re-fetch the current server page after a successful change (used where the list itself must update, e.g. the saved-items page). */
  refreshOnChange?: boolean;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onClick(e: React.MouseEvent) {
    // Rendered inside ProductCard's <Link> — never navigate to the listing on a heart press.
    e.preventDefault();
    e.stopPropagation();

    if (!signedIn) {
      const here = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }

    const wasSaved = saved;
    setError(null);
    setSaved(!wasSaved);
    startTransition(async () => {
      const result = wasSaved ? await unsaveListing(productId) : await saveListing(productId);
      if ("error" in result) {
        setSaved(wasSaved);
        if (result.authRequired) {
          router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        setError(result.error);
        return;
      }
      setSaved(result.saved);
      if (refreshOnChange) router.refresh();
    });
  }

  const label = saved ? `Remove ${title} from saved items` : `Save ${title}`;
  const icon = <Heart className={`h-4 w-4 ${saved ? "fill-bambini-coral text-bambini-coral" : "text-brand-ink"}`} aria-hidden="true" />;

  if (variant === "remove") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          aria-label={label}
          disabled={isPending}
          onClick={onClick}
          className="inline-flex h-9 items-center rounded-button border border-brand-border bg-transparent px-4 text-button text-brand-ink transition-colors duration-150 ease-bambini hover:bg-brand-cream disabled:opacity-60"
        >
          {isPending ? "Removing…" : "Remove"}
        </button>
        {error && (
          <p role="alert" className="text-caption text-brand-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-pressed={saved}
          aria-label={label}
          disabled={isPending}
          onClick={onClick}
          className="inline-flex h-11 w-fit items-center gap-2 rounded-button border border-brand-border bg-brand-surface px-4 text-button text-brand-ink transition-colors duration-150 ease-bambini hover:bg-brand-cream disabled:opacity-60"
        >
          {icon}
          {saved ? "Saved" : "Save"}
        </button>
        {error && (
          <p role="alert" className="text-caption text-brand-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
      <button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        disabled={isPending}
        onClick={onClick}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-bambini-white/90 text-bambini-charcoal shadow-subtle backdrop-blur transition-colors duration-150 ease-bambini hover:bg-bambini-white disabled:opacity-60"
      >
        {icon}
      </button>
      {error && (
        <span role="alert" className="max-w-[9rem] rounded-input bg-brand-surface px-2 py-1 text-caption text-brand-danger shadow-subtle">
          {error}
        </span>
      )}
    </div>
  );
}
