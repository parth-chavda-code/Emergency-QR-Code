import { z } from "zod";
import { qrCredentialModel } from "../models/qr_credential.js";
import { eprofileModel } from "../models/emergency_profile.js";
import { userModel } from "../models/user.js";
import { digestQrToken } from "./qrToken.js";
import { readPublicSnapshot } from "./profileStorage.js";
import { hasSharedInformation } from "./qrCredentials.js";
import { profileSchema, sharingCategories } from "../validation/profile.js";

// Validate decrypted public values too, including fields inside contacts.
const publicProfileSchema = z.strictObject(Object.fromEntries(
  sharingCategories.map(category => [category, (category === "age"
    ? z.number().int().nonnegative()
    : profileSchema.shape[category]).optional()]),
));

export async function resolvePublicEmergency(token, key) {
  let tokenDigest;
  try { tokenDigest = digestQrToken(token); }
  catch { return null; }

  const credential = await qrCredentialModel.findOne({ tokenDigest, state: "active" })
    .select("profileId").maxTimeMS(5000).lean();
  if (!credential) return null;

  const profile = await eprofileModel.findById(credential.profileId)
    .select("userId sharingConsent +publicSnapshot +privatePayload").maxTimeMS(5000).lean();
  if (!profile) return null;
  // Logout does not disable a QR; a deleted account does.
  if (!await userModel.exists({ _id: profile.userId }).maxTimeMS(5000)) return null;

  const publicProfile = readPublicSnapshot(profile, key);
  // Validate without returning signup/profile defaults for unshared categories.
  publicProfileSchema.parse(publicProfile);
  return hasSharedInformation(publicProfile) ? { publicProfile } : null;
}
