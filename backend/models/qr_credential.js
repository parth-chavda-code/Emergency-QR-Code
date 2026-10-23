import mongoose from "mongoose";

const { Schema } = mongoose;
const qrSchema = new Schema(
  {
    profileId: {
      type: Schema.Types.ObjectId,
      ref: "EmergencyProfile",
      required: true,
      immutable: true,
    },
    tokenDigest: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    state: {
      type: String,
      enum: ["pending", "active", "revoked"],
      required: true,
      default: "pending",
    },
    replacesCredentialId: {
      type: Schema.Types.ObjectId,
      ref: "QrCredential",
      immutable: true,
    },
    activatedAt: Date,
    revokedAt: Date,
  },
  {
    collection: "qr_credentials",
    strict: "throw",
    bufferCommands: false,
    autoIndex: true,
    timestamps: true,
  },
);
qrSchema.index({ tokenDigest: 1 }, { unique: true, name: "unique_qr_digest" });
qrSchema.index(
  { profileId: 1 },
  {
    unique: true,
    partialFilterExpression: { state: "active" },
    name: "one_active_qr_per_profile",
  },
);
qrSchema.index({ profileId: 1, createdAt: -1 });
qrSchema.index({ profileId: 1 }, {
  unique: true,
  partialFilterExpression: { state: "pending" },
  name: "one_pending_qr_per_profile",
});

export const qrCredentialModel = mongoose.model("QrCredential", qrSchema);
