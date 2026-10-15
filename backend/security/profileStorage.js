import {
  profileSchema,
  sharingCategories,
  isValidDob,
} from "../validation/profile.js";
import { encryptJson, decryptJson } from "./profileEncryption.js";

function profileContext(profileId, purpose) {
  const id = String(profileId);
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error("Invalid profile ID");
  return `${id}:${purpose}`;
}

export function calculateAge(dob, today = new Date()) {
  if (!isValidDob(dob, today)) throw new Error("Invalid DOB");
  const [year, month, day] = dob.split("-").map(Number);
  let age = today.getUTCFullYear() - year;
  if (
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  )
    age--;
  return age;
}

// Save both envelopes and consent in the same document update on each edit.
export function prepareProfileStorage(profileId, input, key) {
  const { sharingConsent, ...privateData } = profileSchema.parse(input);
  const publicData = {};
  for (const category of sharingCategories) {
    if (
      category !== "age" &&
      sharingConsent[category] &&
      privateData[category] !== undefined
    ) {
      publicData[category] = privateData[category];
    }
  }
  return {
    sharingConsent,
    privatePayload: encryptJson(
      privateData,
      key,
      profileContext(profileId, "private"),
    ),
    publicSnapshot: encryptJson(
      publicData,
      key,
      profileContext(profileId, "public"),
    ),
  };
}

export function readPublicSnapshot(profile, key, today = new Date()) {
  const publicData = decryptJson(
    profile.publicSnapshot,
    key,
    profileContext(profile._id, "public"),
  );
  const result = {};
  for (const category of sharingCategories) {
    if (
      category !== "age" &&
      profile.sharingConsent[category] &&
      Object.hasOwn(publicData, category)
    ) {
      result[category] = publicData[category];
    }
  }
  if (profile.sharingConsent.age) {
    const privateData = decryptJson(
      profile.privatePayload,
      key,
      profileContext(profile._id, "private"),
    );
    result.age = calculateAge(privateData.dob, today);
  }
  return result;
}
