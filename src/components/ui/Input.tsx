import { inputVariants } from "@/lib/ui/variants";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

/** The bare control — wrap with FormField for a labelled, described field. */
export function Input({ invalid, className, ...props }: InputProps) {
  return <input className={inputVariants({ invalid, className })} {...props} />;
}
