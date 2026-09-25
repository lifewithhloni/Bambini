import { Search } from "./icons";

type SearchInputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** A search-specific input — the icon is decorative (the field's own label/placeholder carries the meaning), so it's aria-hidden. */
export function SearchInput({ className = "", "aria-label": ariaLabel = "Search", ...props }: SearchInputProps) {
  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
      <input
        type="search"
        aria-label={ariaLabel}
        className={`w-full rounded-input border border-brand-border bg-brand-surface py-2.5 pl-10 pr-3.5 text-body text-brand-ink placeholder:text-brand-muted transition-colors duration-150 ease-bambini focus-visible:border-bambini-forest ${className}`}
        {...props}
      />
    </div>
  );
}
