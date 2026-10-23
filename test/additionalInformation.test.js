import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema, profileUpdateSchema } from "../backend/validation/profile.js";
import { prepareProfileStorage, readPrivateProfile, readPublicSnapshot } from "../backend/security/profileStorage.js";
import { encryptJson } from "../backend/security/profileEncryption.js";
import { hasSharedInformation } from "../backend/security/qrCredentials.js";

const basic = { displayName: "Example", dob: "1990-01-01" };
const key = "ab".repeat(32);
const id = "507f1f77bcf86cd799439011";

test("additional information is optional, bounded, multiline and independently consented", () => {
  const minimal = profileSchema.parse(basic);
  assert.equal(minimal.additionalInformation, "");
  assert.equal(minimal.sharingConsent.additionalInformation, false);
  assert.equal(profileSchema.parse({ ...basic, additionalInformation: "  First line\nSecond line  " }).additionalInformation, "First line\nSecond line");
  assert.equal(profileSchema.safeParse({ ...basic, additionalInformation: "x".repeat(1000) }).success, true);
  for (const value of [null, 1, [], "x".repeat(1001), "bad\u0000text"]) {
    assert.equal(profileSchema.safeParse({ ...basic, additionalInformation: value }).success, false);
    assert.equal(profileUpdateSchema.safeParse({ revision: 1, additionalInformation: value }).success, false);
  }
  assert.deepEqual(profileUpdateSchema.parse({ revision: 1, additionalInformation: "" }), { revision: 1, additionalInformation: "" });
  assert.equal(Object.hasOwn(profileUpdateSchema.parse({ revision: 1, displayName: "Edited" }), "additionalInformation"), false);
});

test("additional information stays encrypted, requires consent and disappears when cleared", () => {
  const text = "Private additional details\nSecond line";
  const record = input => ({ _id: id, ...prepareProfileStorage(id, input, key) });
  const privateRecord = record({ ...basic, additionalInformation: text });
  assert.doesNotMatch(JSON.stringify(privateRecord), /Private additional details/);
  assert.equal(readPrivateProfile(privateRecord, key).additionalInformation, text);
  assert.deepEqual(readPublicSnapshot(privateRecord, key), {});
  const shared = record({ ...basic, additionalInformation: text, sharingConsent: { additionalInformation: true } });
  assert.deepEqual(readPublicSnapshot(shared, key), { additionalInformation: text });
  assert.equal(hasSharedInformation(readPublicSnapshot(shared, key)), true);
  shared.sharingConsent.additionalInformation = false;
  assert.deepEqual(readPublicSnapshot(shared, key), {});
  const cleared = record({ ...basic, additionalInformation: "  ", sharingConsent: { additionalInformation: true } });
  assert.deepEqual(readPublicSnapshot(cleared, key), {});
  assert.equal(hasSharedInformation(readPublicSnapshot(cleared, key)), false);
});

test("previously encrypted profiles without the new field or consent still read safely", () => {
  const legacy = { _id: id, sharingConsent: { displayName: true },
    privatePayload: encryptJson(basic, key, `${id}:private`),
    publicSnapshot: encryptJson({ displayName: basic.displayName }, key, `${id}:public`) };
  const owner = readPrivateProfile(legacy, key);
  assert.equal(owner.additionalInformation, "");
  assert.equal(owner.sharingConsent.additionalInformation, false);
  assert.deepEqual(readPublicSnapshot(legacy, key), { displayName: basic.displayName });
});
