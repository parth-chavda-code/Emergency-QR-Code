import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email()) // passes it to another schema here z.schema()
  .refine(
    (value) => value.split("@")[0].length <= 64,
    "Email local part is too long",
  );

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .refine(
    (value) => [...value].length <= 100,
    "Name must be at most 100 characters",
  ) // ...value means converts into alphabets like h,e,l,l,o i.e name alphabets array
  .refine(
    (value) => !/\p{Cc}/u.test(value),
    "Name must not contain control characters",
  );

export const loginPasswordSchema = z
  .string()
  .min(1, "Password is required")
  .refine(
    // bcrypt only uses the first 72 bytes. Reject longer input instead of cutting it off.
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must use at most 72 bytes",
  );

const passwordSchema = loginPasswordSchema
  .refine(
    (value) => [...value].length >= 10,
    "Password must have at least 10 characters",
  )
  .refine((value) => /\p{Lu}/u.test(value), "Password must contain an uppercase letter")
  .refine((value) => /\p{Ll}/u.test(value), "Password must contain a lowercase letter")
  .refine((value) => /[\p{P}\p{S}]/u.test(value), "Password must contain a special character");

// Reject unknown fields instead of silently accepting client-supplied account metadata.
export const signupSchema = z.strictObject({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});
