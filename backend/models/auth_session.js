import mongoose from "mongoose";

const { Schema } = mongoose;
const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  {
    collection: "auth_sessions",
    strict: "throw",
    bufferCommands: false,
    autoIndex: true,
    timestamps: true,
  },
);
sessionSchema.index({ userId: 1, revokedAt: 1 });
// Cleanup is delayed; future middleware must check expiresAt itself.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const authSessionModel = mongoose.model("AuthSession", sessionSchema);
