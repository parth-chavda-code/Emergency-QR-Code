import mongoose from "mongoose";

const { Schema } = mongoose;
const auditSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "profile.created",
        "profile.updated",
        "profile.deleted",
        "qr.issued",
        "qr.activated",
        "qr.revoked",
        "auth.login",
        "auth.logout",
      ],
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    profileId: {
      type: Schema.Types.ObjectId,
      ref: "EmergencyProfile",
      immutable: true,
    },
    credentialId: {
      type: Schema.Types.ObjectId,
      ref: "QrCredential",
      immutable: true,
    },
  },
  {
    collection: "audit_events",
    strict: "throw",
    bufferCommands: false,
    autoIndex: true,
    timestamps: { createdAt: true, updatedAt: false },
  },
);
auditSchema.index({ actorUserId: 1, createdAt: -1 });

export const auditEventModel = mongoose.model("AuditEvent", auditSchema);
