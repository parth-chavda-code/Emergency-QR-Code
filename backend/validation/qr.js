import { z } from "zod";

export const credentialIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);
export const issueQrSchema = z.strictObject({
  profileRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export const qrListSchema = z.strictObject({
  limit: z.string().regex(/^[1-9]\d?$/).transform(Number)
    .refine(value => value <= 50).default(20),
  cursor: credentialIdSchema.optional(),
});
export const emptyQrBodySchema = z.strictObject({});
