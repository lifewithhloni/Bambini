import { Card } from "@/components/ui/Card";
import { Star } from "@/components/ui/icons";
import { reviewSectionMode } from "@/lib/reviews/reviewSection";
import type { OrderReview } from "@/server/reviews/getOrderReview";
import { ReviewForm } from "./ReviewForm";

/**
 * The buyer's review area on /account/orders/[id]. What it shows is
 * decided by reviewSectionMode() (a mirror of create_review()'s own
 * eligibility): the form for a completed, un-reviewed order; the
 * submitted review, read-only, once one exists (this is also the
 * post-submit "thank you" state — the page re-renders after the action
 * revalidates); nothing otherwise.
 *
 * No edit, delete, report, seller reply or moderation controls: reviews
 * are immutable in the MVP.
 */
export function ReviewSection({ orderId, orderStatus, review }: { orderId: string; orderStatus: string; review: OrderReview | null }) {
  const mode = reviewSectionMode({ orderStatus, hasReview: review !== null });

  if (mode === "hidden") return null;

  if (mode === "read_only" && review) {
    return (
      <Card>
        <h2 className="mb-2 text-heading-card text-brand-ink">Your review</h2>
        <div className="flex items-center gap-1" role="img" aria-label={`Rated ${review.rating} out of 5 stars`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={`h-5 w-5 ${n <= review.rating ? "fill-bambini-peach text-bambini-peach" : "text-brand-border"}`} aria-hidden="true" />
          ))}
        </div>
        {review.comment && <p className="mt-2 whitespace-pre-line text-body-small text-brand-ink">{review.comment}</p>}
        <p className="mt-2 text-caption text-brand-muted">
          Thanks for your feedback — reviewed {new Date(review.createdAt).toLocaleDateString()}.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-3 text-heading-card text-brand-ink">How was your experience?</h2>
      <ReviewForm orderId={orderId} />
    </Card>
  );
}
