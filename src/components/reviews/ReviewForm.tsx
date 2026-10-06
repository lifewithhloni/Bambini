"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitReview, type ReviewActionState } from "@/server/reviews/actions";
import { REVIEW_COMMENT_MAX } from "@/server/reviews/validation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Star } from "@/components/ui/icons";
import { inputVariants } from "@/lib/ui/variants";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" fullWidth loading={pending}>
      {pending ? "Submitting…" : "Submit review"}
    </Button>
  );
}

/**
 * Submits ONLY the rating and an optional comment; the order is bound
 * server-side (like the dispute form). Who is reviewing and who is being
 * reviewed are never in this form — create_review() derives both.
 *
 * The stars are real radio inputs (keyboard and screen-reader friendly),
 * styled as stars; no star is pre-selected, so a rating is always a
 * deliberate choice.
 */
export function ReviewForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<ReviewActionState, FormData>(submitReview.bind(null, orderId), null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-small font-medium text-brand-ink">Your rating</legend>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="relative cursor-pointer rounded p-0.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bambini-forest"
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name="rating"
                value={n}
                required
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
              />
              <Star className={`h-8 w-8 ${n <= shown ? "fill-bambini-peach text-bambini-peach" : "text-brand-border"}`} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="review-comment" className="text-body-small font-medium text-brand-ink">
          Tell us about your experience <span className="text-brand-muted">(optional)</span>
        </label>
        <textarea id="review-comment" name="comment" rows={4} maxLength={REVIEW_COMMENT_MAX} className={inputVariants()} />
        <p className="text-caption text-brand-muted">Up to {REVIEW_COMMENT_MAX} characters. Your first name and last initial are shown with your review.</p>
      </div>

      {state && "error" in state && <Alert tone="danger">{state.error}</Alert>}

      <SubmitButton />
    </form>
  );
}
