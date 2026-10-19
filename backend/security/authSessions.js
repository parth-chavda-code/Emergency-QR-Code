import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { userModel } from "../models/user.js";
import { authSessionModel } from "../models/auth_session.js";
import { auditEventModel } from "../models/audit_event.js";

const databaseFailures = new Set([
  "MongooseServerSelectionError",
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoTopologyClosedError",
  "MongoNotConnectedError",
  "MongoOperationTimeoutError",
]);

export function isDatabaseFailure(error) {
  return (
    databaseFailures.has(error?.name) ||
    error?.code === 50 ||
    userModel.db.readyState !== 1
  );
}

function loginVersion(value) {
  const version = value;
  if (!Number.isSafeInteger(version) || version < 0)
    throw new Error("Invalid account login version");
  return version;
}

export async function createLoginSession(user, secret) {
  const sessionId = new mongoose.Types.ObjectId(); //generates mongoDb object id
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 900; // 15 min
  // Sign before saving: signing failure must not leave an unused session.
  const token = jwt.sign(
    { sid: sessionId.toString(), iat: issuedAt, exp: expiresAt },
    secret,
    {
      algorithm: "HS256",
      subject: user._id.toString(),
      issuer: "emergency-qr-code",
      audience: "emergency-qr-api",
    },
  );
  await authSessionModel.create({
    _id: sessionId,
    userId: user._id,
    loginVersion: loginVersion(user.loginVersion),
    expiresAt: new Date(expiresAt * 1000),
  });
  // If logout overlapped this login, never return an already-invalid token.
  const active = await findActiveSession(user._id, sessionId);
  return active ? token : null;
}

export async function findActiveSession(userId, sessionId) {
  const session = await authSessionModel
    .findOne({
      _id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
    .maxTimeMS(5000)
    .lean();
  if (!session) return null;
  // Read the account last so a completed global logout invalidates old sessions.
  const user = await userModel
    .findById(userId)
    .select("+loginVersion")
    .maxTimeMS(5000)
    .lean();
  if (
    !user ||
    loginVersion(session.loginVersion) !== loginVersion(user.loginVersion)
  )
    return null;
  return session;
}

export async function logoutEverywhere(userId, currentVersion) {
  const version = loginVersion(currentVersion);
  if (version === Number.MAX_SAFE_INTEGER)
    throw new Error("Account login version limit reached");
  const result = await userModel.updateOne(
    {
      _id: userId,
      // The comparison prevents two overlapping logouts from invalidating a fresh login.
      loginVersion: version,
    },
    { $inc: { loginVersion: 1 } },
    { maxTimeMS: 5000 },
  );
  if (result.modifiedCount !== 1) return false;

  // The version change is authoritative. This marks old rows for easier inspection.
  // A bookkeeping failure must never reverse or falsely report a completed logout.
  try {
    await authSessionModel.updateMany(
      { userId, loginVersion: { $lte: version }, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { maxTimeMS: 5000 },
    );
  } catch {
    console.warn(
      "Session revocation bookkeeping failed; account logout remains effective",
    );
  }
  return true;
}

export async function recordAuthEvent(action, userId) {
  try {
    await auditEventModel.create({ action, actorUserId: userId });
  } catch {
    // No tokens, passwords, user details, or database error contents in warnings.
    console.warn("Authentication audit write failed");
  }
}
