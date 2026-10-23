import { Router } from "express";
import mongoose from "mongoose";
import { eprofileModel } from "../models/emergency_profile.js";
import { auditEventModel } from "../models/audit_event.js";
import { authUser } from "../middlewares/authMiddleware.js";
import { isDatabaseFailure } from "../security/authSessions.js";
import { profileSchema, profileUpdateSchema } from "../validation/profile.js";
import { prepareProfileStorage, readPrivateProfile } from "../security/profileStorage.js";
import { publicPreview } from "../security/qrCredentials.js";
import { qrFailure } from "./qr.js";

const profileRouter = Router();

profileRouter.get("/public-preview", authUser, async (req, res, next) => {
  try {
    return res.status(200).json(await publicPreview(req.userId, req.app.locals.profileEncryptionKey));
  } catch (err) { return qrFailure(err, res, next); }
});

function ownerResponse(profile, key) {
  return { profile: {
    id: profile._id.toString(),
    ...readPrivateProfile(profile, key),
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  } };
}

function profileFailure(err, res, next) {
  if (isDatabaseFailure(err)) {
    return res.set("Retry-After", "5").status(503)
      .json({ error: "Profile temporarily unavailable. Please try again later." });
  }
  return next(err);
}

async function recordProfileEvent(action, userId, profileId) {
  try {
    await auditEventModel.create({ action, actorUserId: userId, profileId });
  } catch {
    // A saved edit remains successful even if its audit write fails.
    console.warn("Profile audit write failed");
  }
}

profileRouter.post("/", authUser, async (req, res, next) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid profile data" });

  try {
    if (await eprofileModel.exists({ userId: req.userId }).maxTimeMS(5000)) {
      return res.status(409).json({ error: "Profile already exists" });
    }
    const _id = new mongoose.Types.ObjectId();
    const stored = prepareProfileStorage(_id, parsed.data, req.app.locals.profileEncryptionKey);
    const profile = await eprofileModel.create({ _id, userId: req.userId, ...stored });
    const response = ownerResponse(profile.toObject(), req.app.locals.profileEncryptionKey);
    await recordProfileEvent("profile.created", req.userId, _id);
    return res.status(201).json(response);
  } catch (err) {
    // The unique ownership index also handles simultaneous creation attempts.
    if (err.code === 11000) return res.status(409).json({ error: "Profile already exists" });
    return profileFailure(err, res, next);
  }
});

profileRouter.get("/", authUser, async (req, res, next) => {
  try {
    const profile = await eprofileModel.findOne({ userId: req.userId })
      .select("+privatePayload").maxTimeMS(5000).lean();
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    return res.status(200).json(ownerResponse(profile, req.app.locals.profileEncryptionKey));
  } catch (err) {
    return profileFailure(err, res, next);
  }
});

profileRouter.patch("/", authUser, async (req, res, next) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid profile update" });

  try {
    const profile = await eprofileModel.findOne({ userId: req.userId })
      .select("+privatePayload").maxTimeMS(5000).lean();
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    const { revision, sharingConsent, ...changes } = parsed.data;
    if (profile.revision !== revision) {
      return res.status(409).json({ error: "Profile changed. Reload it before editing." });
    }
    const current = readPrivateProfile(profile, req.app.locals.profileEncryptionKey);
    const merged = { ...current, ...changes,
      sharingConsent: { ...current.sharingConsent, ...sharingConsent } };
    // null explicitly clears optional blood type; omitted blood type is preserved.
    if (merged.bloodType === null) delete merged.bloodType;
    const validated = profileSchema.safeParse(merged);
    if (!validated.success) return res.status(400).json({ error: "Invalid profile update" });

    const stored = prepareProfileStorage(profile._id, validated.data, req.app.locals.profileEncryptionKey);
    // One conditional write changes both payloads, consent, and revision together.
    const updated = await eprofileModel.findOneAndUpdate({
      _id: profile._id, userId: req.userId, revision,
    }, { $set: stored, $inc: { revision: 1 } }, {
      returnDocument: "after", runValidators: true, maxTimeMS: 5000,
    }).select("+privatePayload").lean();
    if (!updated) return res.status(409).json({ error: "Profile changed. Reload it before editing." });
    const response = ownerResponse(updated, req.app.locals.profileEncryptionKey);
    await recordProfileEvent("profile.updated", req.userId, profile._id);
    return res.status(200).json(response);
  } catch (err) {
    return profileFailure(err, res, next);
  }
});

export { profileRouter };
