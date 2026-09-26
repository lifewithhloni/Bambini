"use client";

import { X } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/IconButton";
import { useCart } from "@/lib/cart/useCart";

export function RemoveFromCartButton({ id, title }: { id: string; title: string | null }) {
  const { remove } = useCart();
  return (
    <IconButton size="sm" aria-label={title ? `Remove ${title} from cart` : "Remove item from cart"} onClick={() => remove(id)}>
      <X className="h-4 w-4" aria-hidden="true" />
    </IconButton>
  );
}
