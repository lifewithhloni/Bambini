import { Loader2 } from "./icons";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "@/lib/ui/variants";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
};

/**
 * A real <button> — never a <div> pretending to be one (see this
 * phase's accessibility report). `loading` disables the button and
 * swaps in a spinner while keeping its label in the DOM (announced via
 * aria-busy) rather than replacing it, so the button doesn't jump size.
 */
export function Button({ variant, size, fullWidth, loading = false, disabled, className, children, ...props }: ButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      className={buttonVariants({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
