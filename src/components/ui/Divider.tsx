export function Divider({ className = "" }: { className?: string }) {
  return <hr className={`border-t border-brand-border ${className}`} />;
}
