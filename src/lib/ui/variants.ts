/**
 * Pure class-name builder functions for the Bambini UI kit — kept
 * separate from the JSX components themselves specifically so they're
 * unit-testable with the project's existing plain-Node vitest setup
 * (no jsdom/React Testing Library exists in this codebase yet — see
 * this phase's own report for why one wasn't added). Each function
 * takes a variant/tone/size and returns the exact Tailwind class string
 * a component should apply; the components below just call these.
 */

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

// Focus-visible styling is intentionally NOT set per-component here —
// globals.css defines one global `:focus-visible` outline (Bambini
// Forest, 2px, offset) that every focusable element inherits
// automatically, so every component in this file is consistent by
// construction rather than by each one repeating the same utility.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-button text-button whitespace-nowrap transition-colors duration-150 ease-bambini disabled:pointer-events-none disabled:opacity-50";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4",
  md: "h-11 px-5",
  lg: "h-13 px-6 text-base",
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-sage-dark text-white hover:bg-bambini-green active:bg-bambini-forest",
  secondary: "bg-brand-light-sage text-brand-ink hover:bg-brand-sage",
  outline: "border border-brand-border bg-transparent text-brand-ink hover:bg-brand-surface",
  ghost: "bg-transparent text-brand-ink hover:bg-brand-cream",
  destructive: "bg-brand-danger text-white hover:opacity-90",
};

export function buttonVariants(opts: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}): string {
  const { variant = "primary", size = "md", fullWidth = false, className = "" } = opts;
  return [BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], fullWidth ? "w-full" : "", className].filter(Boolean).join(" ");
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const BADGE_BASE = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-brand-border text-brand-ink",
  success: "bg-brand-sage-dark/15 text-brand-sage-dark",
  warning: "bg-bambini-peach/25 text-bambini-charcoal",
  danger: "bg-brand-danger/10 text-brand-danger",
  info: "bg-brand-light-sage text-brand-ink",
  accent: "bg-bambini-coral/20 text-bambini-charcoal",
};

export function badgeVariants(opts: { tone?: BadgeTone; className?: string } = {}): string {
  const { tone = "neutral", className = "" } = opts;
  return [BADGE_BASE, BADGE_TONES[tone], className].filter(Boolean).join(" ");
}

export type ChipTone = "default" | "selected";

const CHIP_BASE = "inline-flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-body-small font-medium transition-colors duration-150 ease-bambini";

const CHIP_TONES: Record<ChipTone, string> = {
  default: "border-brand-border bg-brand-surface text-brand-ink hover:bg-brand-cream",
  selected: "border-bambini-forest bg-bambini-forest text-white",
};

export function chipVariants(opts: { selected?: boolean; className?: string } = {}): string {
  const { selected = false, className = "" } = opts;
  return [CHIP_BASE, CHIP_TONES[selected ? "selected" : "default"], className].filter(Boolean).join(" ");
}

export type CardElevation = "none" | "subtle" | "card" | "elevated";

const CARD_ELEVATIONS: Record<CardElevation, string> = {
  none: "shadow-none",
  subtle: "shadow-subtle",
  card: "shadow-card",
  elevated: "shadow-elevated",
};

export function cardVariants(opts: { elevation?: CardElevation; padded?: boolean; interactive?: boolean; className?: string } = {}): string {
  const { elevation = "card", padded = true, interactive = false, className = "" } = opts;
  return [
    "rounded-card bg-brand-surface border border-brand-border",
    CARD_ELEVATIONS[elevation],
    padded ? "p-4" : "",
    interactive ? "transition-shadow duration-150 ease-bambini hover:shadow-elevated" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

const INPUT_BASE =
  "w-full rounded-input border border-brand-border bg-brand-surface px-3.5 py-2.5 text-body text-brand-ink placeholder:text-brand-muted transition-colors duration-150 ease-bambini focus-visible:border-bambini-forest disabled:cursor-not-allowed disabled:bg-brand-border/40 disabled:text-brand-muted";

const INPUT_ERROR = "border-brand-danger focus-visible:border-brand-danger";

export function inputVariants(opts: { invalid?: boolean; className?: string } = {}): string {
  const { invalid = false, className = "" } = opts;
  return [INPUT_BASE, invalid ? INPUT_ERROR : "", className].filter(Boolean).join(" ");
}
