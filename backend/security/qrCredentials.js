import mongoose from "mongoose";
import { eprofileModel } from "../models/emergency_profile.js";
import { qrCredentialModel } from "../models/qr_credential.js";
import { auditEventModel } from "../models/audit_event.js";
import { readPublicSnapshot } from "./profileStorage.js";
import { generateQrToken } from "./qrToken.js";
import { validatePublicBaseUrl } from "../config.js";
import { isDatabaseFailure } from "./authSessions.js";

export class QrRequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Explicit response fields: never serialize a digest, token, or full database record.
export function credentialResponse(credential) {
  return {
    id: credential._id.toString(), state: credential.state,
    replacesCredentialId: credential.replacesCredentialId?.toString() ?? null,
    createdAt: credential.createdAt, updatedAt: credential.updatedAt,
    activatedAt: credential.activatedAt ?? null, revokedAt: credential.revokedAt ?? null,
  };
}

export function hasSharedInformation(publicProfile) {
  return Object.values(publicProfile).some(value =>
    (typeof value === "string" && value.trim().length > 0)
    || (Array.isArray(value) && value.length > 0)
    || (typeof value === "number" && Number.isFinite(value)),
  );
}

function requireSharedInformation(profile, key) {
  if (!hasSharedInformation(readPublicSnapshot(profile, key))) {
    throw new QrRequestError(409, "Share at least one nonempty field or category before issuing or activating a QR");
  }
}

export async function publicPreview(userId, key) {
  const profile = await eprofileModel.findOne({ userId })
    .select("+privatePayload +publicSnapshot").maxTimeMS(5000).lean();
  if (!profile) throw new QrRequestError(404, "Profile not found");
  const publicProfile = readPublicSnapshot(profile, key);
  return { publicProfile, profileRevision: profile.revision,
    hasSharedInformation: hasSharedInformation(publicProfile) };
}

async function profileTransaction(userId, work) {
  try {
    // Check without starting any mutation. Standalone databases remain usable for auth/profile.
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }, { maxTimeMS: 5000 });
    if (!hello.setName && hello.msg !== "isdbgrid") {
      throw new QrRequestError(503, "QR changes require MongoDB transaction support");
    }
    return await mongoose.connection.transaction(async session => {
      // This real write coordinates every QR change with simultaneous profile edits.
      // Do not alter the owner's content revision or last-updated timestamp for QR actions.
      const profile = await eprofileModel.findOneAndUpdate({ userId },
        { $inc: { qrChangeVersion: 1 } }, {
          session, returnDocument: "after", timestamps: false, maxTimeMS: 5000,
        }).select("+privatePayload +publicSnapshot").lean();
      if (!profile) throw new QrRequestError(404, "Profile not found");
      return work(profile, session);
    }, { readPreference: "primary", readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" }, maxCommitTimeMS: 5000, timeoutMS: 10000 });
  } catch (err) {
    if (err instanceof QrRequestError) throw err;
    if (err?.code === 11000) throw new QrRequestError(409, "QR state changed. Reload your QR list before retrying.");
    if (isDatabaseFailure(err) || [20, 303, 112, 251].includes(err?.code)
        || err?.hasErrorLabel?.("UnknownTransactionCommitResult")
        || err?.hasErrorLabel?.("TransientTransactionError")) {
      throw new QrRequestError(503, "QR temporarily unavailable. Please try again later.");
    }
    throw err;
  }
}

async function audit(action, userId, profileId, credentialId, session) {
  // QR audit writes belong to the same transaction: failure rolls back the action.
  await auditEventModel.create([{ action, actorUserId: userId, profileId, credentialId }], { session });
}

export async function listCredentials(userId, { limit, cursor }) {
  const profile = await eprofileModel.findOne({ userId }).select("_id").maxTimeMS(5000).lean();
  if (!profile) throw new QrRequestError(404, "Profile not found");
  const records = await qrCredentialModel.find({ profileId: profile._id,
    ...(cursor ? { _id: { $lt: cursor } } : {}) })
    .sort({ _id: -1 }).limit(limit + 1).maxTimeMS(5000).lean();
  const more = records.length > limit;
  const page = records.slice(0, limit);
  return { credentials: page.map(credentialResponse),
    nextCursor: more ? page.at(-1)._id.toString() : null };
}

export async function issueCredential(userId, profileRevision, key, publicBaseUrl) {
  const origin = validatePublicBaseUrl(publicBaseUrl);
  // Keep token and ID stable if the driver retries the transaction callback.
  const { token, tokenDigest } = generateQrToken();
  const _id = new mongoose.Types.ObjectId();
  const credential = await profileTransaction(userId, async (profile, session) => {
    if (profile.revision !== profileRevision) {
      throw new QrRequestError(409, "Profile changed. Review the public preview again before issuing a QR.");
    }
    requireSharedInformation(profile, key);
    if (await qrCredentialModel.exists({ profileId: profile._id, state: "pending" }).session(session)) {
      throw new QrRequestError(409, "A pending QR already exists. Activate or revoke it first.");
    }
    const active = await qrCredentialModel.findOne({ profileId: profile._id, state: "active" }).session(session).lean();
    const [created] = await qrCredentialModel.create([{
      _id, profileId: profile._id, tokenDigest, state: "pending",
      ...(active ? { replacesCredentialId: active._id } : {}),
    }], { session });
    await audit("qr.issued", userId, profile._id, _id, session);
    return credentialResponse(created);
  });
  return { credential, token, qrUrl: `${origin}/e/${token}` };
}

export async function activateCredential(userId, credentialId, key) {
  return profileTransaction(userId, async (profile, session) => {
    const credential = await qrCredentialModel.findOne({ _id: credentialId, profileId: profile._id }).session(session).lean();
    if (!credential) throw new QrRequestError(404, "QR credential not found");
    if (credential.state === "revoked") throw new QrRequestError(409, "A revoked QR cannot be activated");
    if (credential.state === "active") return { credential: credentialResponse(credential) };
    requireSharedInformation(profile, key);
    const active = await qrCredentialModel.findOne({ profileId: profile._id, state: "active" }).session(session).lean();
    const now = new Date();
    if (active) {
      if (credential.replacesCredentialId?.toString() !== active._id.toString()) {
        throw new QrRequestError(409, "The active QR changed. Revoke this pending QR and issue another replacement.");
      }
      const revoked = await qrCredentialModel.updateOne({ _id: active._id, profileId: profile._id, state: "active" },
        { $set: { state: "revoked", revokedAt: now } }, { session });
      if (revoked.modifiedCount !== 1) throw new QrRequestError(409, "QR state changed. Reload your QR list.");
      await audit("qr.revoked", userId, profile._id, active._id, session);
    }
    const activated = await qrCredentialModel.findOneAndUpdate({ _id: credential._id,
      profileId: profile._id, state: "pending" }, { $set: { state: "active", activatedAt: now } },
    { session, returnDocument: "after", runValidators: true }).lean();
    if (!activated) throw new QrRequestError(409, "QR state changed. Reload your QR list.");
    await audit("qr.activated", userId, profile._id, credential._id, session);
    return { credential: credentialResponse(activated) };
  });
}

export async function revokeCredential(userId, credentialId) {
  return profileTransaction(userId, async (profile, session) => {
    const credential = await qrCredentialModel.findOne({ _id: credentialId, profileId: profile._id }).session(session).lean();
    if (!credential) throw new QrRequestError(404, "QR credential not found");
    if (credential.state === "revoked") return { credential: credentialResponse(credential) };
    const revoked = await qrCredentialModel.findOneAndUpdate({ _id: credential._id, profileId: profile._id,
      state: { $in: ["pending", "active"] } }, { $set: { state: "revoked", revokedAt: new Date() } },
    { session, returnDocument: "after", runValidators: true }).lean();
    if (!revoked) throw new QrRequestError(409, "QR state changed. Reload your QR list.");
    await audit("qr.revoked", userId, profile._id, credential._id, session);
    return { credential: credentialResponse(revoked) };
  });
}
