import { z } from "zod";

export const fulfilmentTypeSchema = z.enum(["collection", "delivery"]);
export type FulfilmentTypeInput = z.infer<typeof fulfilmentTypeSchema>;

// Display/UX only — create_order() independently re-validates that cash
// is only ever combined with collection, never delivery (see
// 20260927090000_cash_collection_transactions.sql); this schema exists
// so a malformed/missing form field fails with a friendly message before
// ever reaching the database, not as the actual security boundary.
export const paymentMethodSchema = z.enum(["online", "cash"]);
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
