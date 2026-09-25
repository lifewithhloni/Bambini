type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required, not optional — an icon-only control with no visible text
      needs an accessible name or it's unusable with a screen reader. */
  "aria-label": string;
  size?: "sm" | "md";
};

const SIZES = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

/**
 * A circular, icon-only button. TypeScript enforces `aria-label` as a
 * required prop (not just a lint rule) so it's impossible to render one
 * without an accessible name.
 */
export function IconButton({ size = "md", className = "", children, ...props }: IconButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      className={`inline-flex items-center justify-center rounded-full text-brand-ink transition-colors duration-150 ease-bambini hover:bg-brand-cream disabled:pointer-events-none disabled:opacity-50 ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
