import { z } from "zod";

export const fulfilmentTypeSchema = z.enum(["collection", "delivery"]);
export type FulfilmentTypeInput = z.infer<typeof fulfilmentTypeSchema>;
