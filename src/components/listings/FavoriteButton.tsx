"use client";

import { Heart } from "@/components/ui/icons";

/**
 * Presentational only — there is no favourites/saved-items backend
 * feature yet (per this phase's own "do not hardcode fake marketplace
 * data into production flows" instruction), so ProductCard only renders
 * this when a caller passes both `isFavorited` and `onToggle`; nothing
 * wires it up today. Kept as its own tiny client component so
 * ProductCard itself can stay a Server Component — only this leaf needs
 * interactivity.
 */
export function FavoriteButton({ isFavorited, onToggle, label }: { isFavorited: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={isFavorited}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-bambini-white/90 text-bambini-charcoal shadow-subtle backdrop-blur transition-colors duration-150 ease-bambini hover:bg-bambini-white"
    >
      <Heart className={`h-4 w-4 ${isFavorited ? "fill-bambini-coral text-bambini-coral" : "text-brand-ink"}`} aria-hidden="true" />
    </button>
  );
}
