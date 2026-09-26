import { CartItem } from "./CartItem";
import type { CartLine } from "@/server/cart/getCartListings";

export function CartItemList({ lines }: { lines: CartLine[] }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Cart items">
      {lines.map((line) => (
        <CartItem key={line.id} line={line} />
      ))}
    </ul>
  );
}
