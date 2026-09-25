import { inputVariants } from "@/lib/ui/variants";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  return <textarea rows={rows} className={inputVariants({ invalid, className: `resize-y ${className ?? ""}` })} {...props} />;
}
