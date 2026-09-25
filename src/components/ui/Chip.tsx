import { chipVariants } from "@/lib/ui/variants";

/**
 * A selectable pill — category chips and filter chips are the same
 * shape with different data, so one component serves both rather than
 * two near-duplicates. Renders a real <button> with aria-pressed, never
 * a styled <div onClick>.
 */
export function Chip({
  selected = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button type="button" aria-pressed={selected} className={chipVariants({ selected, className })} {...props}>
      {children}
    </button>
  );
}
