import mongoose from "mongoose";
import { sharingCategories, consentSchema } from "../validation/profile.js";
import { envelopeSchema } from "../security/profileEncryption.js";

const { Schema } = mongoose;
const encryptedPayload = new Schema(
  {
    version: { type: Number, required: true, enum: [1] },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false, strict: "throw" },
);
const consent = new Schema(
  Object.fromEntries(
    sharingCategories.map((category) => [
      category,
      { type: Boolean, required: true, default: false },
    ]),
  ),
  { _id: false, strict: "throw" },
);

const profileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    privatePayload: {
      type: encryptedPayload,
      required: true,
      select: false,
      validate: (value) => envelopeSchema.safeParse(value.toObject()).success,
    },
    publicSnapshot: {
      type: encryptedPayload,
      required: true,
      select: false,
      validate: (value) => envelopeSchema.safeParse(value.toObject()).success,
    },
    sharingConsent: {
      type: consent,
      required: true,
      default: () => consentSchema.parse({}),
    },
    revision: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      validate: Number.isSafeInteger,
    },
  },
  {
    collection: "emergency_profiles",
    strict: "throw",
    bufferCommands: false,
    autoIndex: true,
    timestamps: true,
  },
);
profileSchema.index(
  { userId: 1 },
  { unique: true, name: "one_profile_per_user" },
);

export const eprofileModel = mongoose.model("EmergencyProfile", profileSchema);
