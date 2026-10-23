import { z } from "zod";
import { nameSchema } from "./user.js";

export const sharingCategories = [
  "displayName",
  "age",
  "bloodType",
  "allergies",
  "medicalCondition",
  "medications",
  "additionalInformation",
  "emergencyContact",
];

// A calendar date, not a timestamp. UTC is used consistently for birthdays.
export function isValidDob(value, today = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    Number(value.slice(0, 4)) >= 1 &&
    date.toISOString().slice(0, 10) === value && // converts out of range day into following month and compares with the input value
    value <= today.toISOString().slice(0, 10)
  );
}

export const consentSchema = z.strictObject(
  Object.fromEntries(
    sharingCategories.map((category) => [category, z.boolean().default(false)]),
  ),
);
const medicalText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => !/\p{Cc}/u.test(value),
    "Control characters are not allowed",
  );
// Free text may contain line breaks/tabs, but not other control characters.
const additionalInformationSchema = z.string().trim().max(1000).refine(
  value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value),
  "Control characters are not allowed",
);
const medicalList = z.array(medicalText).max(30).default([]); // contains array and must follow z rules of medical text, max 30 is max total array length
const contactSchema = z.strictObject({
  name: nameSchema,
  // International format avoids guessing a phone number's country.
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/),
  relation: nameSchema.optional(),
});

export const profileSchema = z
  .strictObject({
    displayName: nameSchema,
    dob: z
      .string()
      .refine(
        (value) => isValidDob(value),
        "DOB must be a valid non-future date (YYYY-MM-DD)",
      ),
    bloodType: z
      .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
      .optional(),
    allergies: medicalList,
    medicalCondition: medicalList,
    medications: medicalList,
    additionalInformation: additionalInformationSchema.default(""),
    emergencyContact: z.array(contactSchema).max(5).default([]),
    sharingConsent: consentSchema.default(() => consentSchema.parse({})),
  })
  .refine(
    ({ sharingConsent, ...data }) =>
      Buffer.byteLength(JSON.stringify(data), "utf8") <= 64000,
    "Profile contents must use at most 64000 bytes",
  );

// Update fields must have no creation defaults: omission means "keep the current value".
export const profileUpdateSchema = z
  .strictObject({
    revision: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    displayName: profileSchema.shape.displayName.optional(),
    dob: profileSchema.shape.dob.optional(),
    bloodType: profileSchema.shape.bloodType.nullable(),
    allergies: medicalList.unwrap().optional(),
    medicalCondition: medicalList.unwrap().optional(),
    medications: medicalList.unwrap().optional(),
    additionalInformation: additionalInformationSchema.optional(),
    emergencyContact: z.array(contactSchema).max(5).optional(),
    sharingConsent: z
      .strictObject(
        Object.fromEntries(
          sharingCategories.map((category) => [
            category,
            z.boolean().optional(),
          ]),
        ),
      )
      .refine(
        (value) => Object.keys(value).length > 0,
        "Provide a consent change",
      )
      .optional(),
  })
  .refine(
    ({ revision, ...changes }) => Object.keys(changes).length > 0,
    "Provide at least one profile change",
  );
