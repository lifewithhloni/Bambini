import Image from "next/image";

const SIZES = {
  sm: { box: "h-8 w-8", text: "text-caption", px: 32 },
  md: { box: "h-11 w-11", text: "text-body-small", px: 44 },
  lg: { box: "h-16 w-16", text: "text-heading-card", px: 64 },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Falls back to initials-on-a-tinted-circle when there's no image
 * (never a broken-image icon, never blank) — the same "the UI should
 * never feel broken when data is missing" principle as EmptyState/
 * ErrorState.
 */
export function Avatar({ name, imageUrl, size = "md" }: { name: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const s = SIZES[size];
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-full bg-brand-light-sage ${s.box}`}>
      {imageUrl ? (
        <Image src={imageUrl} alt="" fill sizes={`${s.px}px`} className="object-cover" />
      ) : (
        <span className={`flex h-full w-full items-center justify-center font-semibold text-bambini-forest ${s.text}`} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <span className="sr-only">{name}</span>
    </div>
  );
}
