import Link from "next/link";
import { Star, Check } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/Avatar";

/**
 * A generic seller/business identity card — deliberately data-shaped
 * around what profiles_public/businesses_public already expose (full
 * name or business name, avatar/logo, rating, verification status),
 * never a raw `profiles`/`businesses` row. `href` is optional so this
 * also works as a plain non-interactive summary (e.g. inside an order
 * detail page) as well as a link to a public seller/business profile.
 */
export function SellerCard({
  name,
  avatarUrl,
  ratingAverage,
  ratingCount,
  isVerified,
  subtitle,
  href,
}: {
  name: string;
  avatarUrl?: string | null;
  ratingAverage?: number | null;
  ratingCount?: number;
  isVerified?: boolean;
  subtitle?: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-card bg-brand-surface p-3 shadow-subtle">
      <Avatar name={name} imageUrl={avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-heading-card text-brand-ink">{name}</p>
          {isVerified && (
            <span title="Verified" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-bambini-forest">
              <Check className="h-2.5 w-2.5 text-white" aria-hidden="true" strokeWidth={3} />
              <span className="sr-only">Verified</span>
            </span>
          )}
        </div>
        {typeof ratingAverage === "number" ? (
          <div className="flex items-center gap-1 text-caption text-brand-muted">
            <Star className="h-3.5 w-3.5 fill-bambini-peach text-bambini-peach" aria-hidden="true" />
            <span>
              {ratingAverage.toFixed(1)} {ratingCount !== undefined && `(${ratingCount})`}
            </span>
          </div>
        ) : (
          subtitle && <p className="truncate text-caption text-brand-muted">{subtitle}</p>
        )}
      </div>
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block transition-opacity duration-150 ease-bambini hover:opacity-90">
      {content}
    </Link>
  );
}
