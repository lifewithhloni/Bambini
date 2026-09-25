import { ChevronDown } from "./icons";
import { inputVariants } from "@/lib/ui/variants";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select className={inputVariants({ invalid, className: `appearance-none pr-9 ${className ?? ""}` })} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
    </div>
  );
}
