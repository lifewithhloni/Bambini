import { cardVariants, type CardElevation } from "@/lib/ui/variants";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  elevation?: CardElevation;
  padded?: boolean;
  interactive?: boolean;
};

export function Card({ elevation, padded, interactive, className, children, ...props }: CardProps) {
  return (
    <div className={cardVariants({ elevation, padded, interactive, className })} {...props}>
      {children}
    </div>
  );
}
