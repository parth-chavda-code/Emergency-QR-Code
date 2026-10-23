import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import mongoose from "mongoose";
import {
  profileSchema,
  sharingCategories,
} from "../backend/validation/profile.js";
import {
  encryptJson,
  decryptJson,
} from "../backend/security/profileEncryption.js";
import {
  prepareProfileStorage,
  readPublicSnapshot,
  calculateAge,
} from "../backend/security/profileStorage.js";
import { generateQrToken, digestQrToken } from "../backend/security/qrToken.js";
import { eprofileModel } from "../backend/models/emergency_profile.js";
import { qrCredentialModel } from "../backend/models/qr_credential.js";
import { authSessionModel } from "../backend/models/auth_session.js";
import { auditEventModel } from "../backend/models/audit_event.js";
import { connectDB, disconnectDB } from "../backend/db.js";

const key = randomBytes(32).toString("hex");
const input = { displayName: "Storage Test Person", dob: "1995-10-14" };
const id = () => new mongoose.Types.ObjectId();

test("profile defaults are private and optional categories can be empty", () => {
  const parsed = profileSchema.parse(input);
  for (const category of sharingCategories)
    assert.equal(parsed.sharingConsent[category], false);
  for (const field of [
    "allergies",
    "medicalCondition",
    "medications",
    "emergencyContact",
  ])
    assert.deepEqual(parsed[field], []);
  const profileId = id();
  const stored = prepareProfileStorage(profileId, input, key);
  assert.deepEqual(readPublicSnapshot({ _id: profileId, ...stored }, key), {});
});

test("profile rejects missing fields, invalid dates, unexpected fields and consent types", () => {
  for (const patch of [
    { displayName: undefined },
    { displayName: " " },
    { dob: undefined },
    { dob: "2023-02-29" },
    { dob: "2024-02-30" },
    { dob: "9999-01-01" },
    { dob: "1995-10-14T00:00:00Z" },
    { dob: "0000-01-01" },
    { qrcodeToken: "raw" },
    { sharingConsent: { dob: true } },
    { sharingConsent: { age: "true" } },
    { allergies: [" "] },
    { medicalCondition: ["x".repeat(501)] },
    { medications: Array(31).fill("medicine") },
    { bloodType: "unknown" },
    { emergencyContact: [{ name: "Someone", phone: "12345" }] },
    {
      emergencyContact: Array(6).fill({
        name: "Someone",
        phone: "+919876543210",
      }),
    },
  ]) {
    assert.equal(
      profileSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
  }
  assert.equal(
    profileSchema.safeParse({ ...input, dob: "2000-02-29" }).success,
    true,
  );
});

test("encryption roundtrip, fresh randomness, wrong keys and altered data", () => {
  const first = encryptJson(input, key, "test:private");
  const second = encryptJson(input, key, "test:private");
  assert.deepEqual(decryptJson(first, key, "test:private"), input);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const changed = (value) => {
    const bytes = Buffer.from(value, "base64");
    bytes[0] ^= 1;
    return bytes.toString("base64");
  };
  for (const envelope of [
    { ...first, iv: changed(first.iv) },
    { ...first, tag: changed(first.tag) },
    { ...first, ciphertext: changed(first.ciphertext) },
    { ...first, version: 2 },
    { ...first, tag: "AA==" },
    { ...first, extra: input.displayName },
  ]) {
    assert.throws(
      () => decryptJson(envelope, key, "test:private"),
      /^Error: Profile information could not be decrypted$/,
    );
  }
  assert.throws(() =>
    decryptJson(first, randomBytes(32).toString("hex"), "test:private"),
  );
  assert.throws(() => decryptJson(first, key, "other:private"));
  assert.throws(() => decryptJson(first, key, "test:public"));
  assert.throws(() => encryptJson(input, "bad-key", "test:private"));
  assert.throws(() => encryptJson(input, key, ""));
  assert.throws(() =>
    encryptJson({ big: "x".repeat(64000) }, key, "test:private"),
  );
});

test("snapshot shares whole consented categories only; DOB and stored age never appear", () => {
  const profileId = id();
  const details = {
    ...input,
    medicalCondition: ["Condition One", "Condition Two", "Condition Three"],
    medications: ["Private Medicine"],
    emergencyContact: [{ name: "Contact Name", phone: "+919876543210" }],
    sharingConsent: { medicalCondition: true, age: true },
  };
  const stored = prepareProfileStorage(profileId, details, key);
  const publicStored = decryptJson(
    stored.publicSnapshot,
    key,
    `${profileId}:public`,
  );
  assert.deepEqual(publicStored, {
    medicalCondition: details.medicalCondition,
  });
  const record = { _id: profileId, ...stored };
  const before = readPublicSnapshot(
    record,
    key,
    new Date("2026-10-13T23:59:59Z"),
  );
  const after = readPublicSnapshot(
    record,
    key,
    new Date("2026-10-14T00:00:00Z"),
  );
  assert.deepEqual(before, {
    medicalCondition: details.medicalCondition,
    age: 30,
  });
  assert.equal(after.age, 31);
  record.sharingConsent.age = false;
  record.sharingConsent.medicalCondition = false;
  assert.deepEqual(readPublicSnapshot(record, key), {});
  assert.throws(() => readPublicSnapshot({ ...record, _id: id() }, key));
  const edited = prepareProfileStorage(
    profileId,
    { ...details, medications: ["Edited Medicine"] },
    key,
  );
  assert.equal(edited.sharingConsent.medications, false);
  assert.doesNotMatch(
    JSON.stringify(edited),
    /Private Medicine|Condition One|Contact Name|1995-10-14/,
  );
});

test("age calculation handles birthdays and leap-day birthdays consistently in UTC", () => {
  assert.equal(
    calculateAge("2000-02-29", new Date("2025-02-28T23:59:59Z")),
    24,
  );
  assert.equal(
    calculateAge("2000-02-29", new Date("2025-03-01T00:00:00Z")),
    25,
  );
  assert.throws(() => calculateAge("2023-02-29"));
});

test("QR helper returns random tokens with stable digests and rejects malformed tokens", () => {
  const first = generateQrToken();
  const second = generateQrToken();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenDigest, second.tokenDigest);
  assert.equal(digestQrToken(first.token), first.tokenDigest);
  assert.match(first.tokenDigest, /^[a-f0-9]{64}$/);
  for (const token of [
    undefined,
    "",
    "short",
    first.tokenDigest,
    "!".repeat(43),
  ])
    assert.throws(() => digestQrToken(token));
});

test("models reject plaintext profile fields, raw QR tokens and sensitive audit metadata", async () => {
  const profileId = id();
  const stored = prepareProfileStorage(profileId, input, key);
  assert.throws(
    () => new eprofileModel({ userId: id(), ...stored, dob: input.dob }),
    /strict/i,
  );
  assert.throws(
    () =>
      new qrCredentialModel({
        profileId,
        tokenDigest: generateQrToken().tokenDigest,
        token: "raw-token",
      }),
    /strict/i,
  );
  assert.throws(
    () =>
      new auditEventModel({
        actorUserId: id(),
        action: "auth.login",
        password: "secret",
      }),
    /strict/i,
  );
  await assert.rejects(
    new eprofileModel({
      userId: id(),
      ...stored,
      privatePayload: { ...stored.privatePayload, tag: "AA==" },
    }).validate(),
  );
  await assert.rejects(new eprofileModel({ ...stored }).validate());
  await assert.rejects(
    new eprofileModel({ userId: id(), ...stored, revision: 1.5 }).validate(),
  );
  await assert.rejects(
    new qrCredentialModel({ profileId, tokenDigest: "raw-token" }).validate(),
  );
  await assert.rejects(
    new qrCredentialModel({
      profileId,
      tokenDigest: generateQrToken().tokenDigest,
      state: "invalid",
    }).validate(),
  );
  await assert.rejects(new authSessionModel({ userId: id() }).validate());
  await assert.rejects(
    new auditEventModel({
      actorUserId: id(),
      action: "private medical details",
    }).validate(),
  );
});

test(
  "Milestone 2 storage with real MongoDB",
  { skip: !process.env.TEST_MONGODB_URI, timeout: 30000 },
  async (t) => {
    await connectDB(process.env.TEST_MONGODB_URI);
    t.after(disconnectDB);
    const userId = id();
    const profileId = id();
    const stored = prepareProfileStorage(
      profileId,
      {
        ...input,
        medications: ["Sensitive Medication"],
        emergencyContact: [{ name: "Private Contact", phone: "+919876543210" }],
        sharingConsent: { displayName: true },
      },
      key,
    );
    await t.test(
      "encrypted records, hidden default queries and unique ownership",
      async () => {
        const profile = await eprofileModel.create({
          _id: profileId,
          userId,
          ...stored,
        });
        assert.equal(profile.revision, 1);
        assert.ok(profile.createdAt instanceof Date);
        const ordinary = await eprofileModel.findById(profileId).lean();
        assert.equal(ordinary.privatePayload, undefined);
        assert.equal(ordinary.publicSnapshot, undefined);
        const dump = await eprofileModel.collection.findOne({ _id: profileId });
        assert.doesNotMatch(
          JSON.stringify(dump),
          /Storage Test Person|1995-10-14|Sensitive Medication|Private Contact|919876543210/,
        );
        assert.deepEqual(readPublicSnapshot(dump, key), {
          displayName: input.displayName,
        });
        await assert.rejects(
          eprofileModel.create({
            userId,
            ...prepareProfileStorage(id(), input, key),
          }),
          { code: 11000 },
        );
        const indexes = await eprofileModel.collection.indexes();
        assert.equal(
          indexes.find((index) => index.name === "one_profile_per_user").unique,
          true,
        );
      },
    );
    await t.test(
      "digest-only QR records and one active QR per profile",
      async () => {
        const { token, tokenDigest } = generateQrToken();
        const first = await qrCredentialModel.create({
          profileId,
          tokenDigest,
          state: "active",
        });
        const raw = await qrCredentialModel.collection.findOne({
          _id: first._id,
        });
        assert.equal(raw.tokenDigest, digestQrToken(token));
        assert.equal(raw.token, undefined);
        assert.doesNotMatch(JSON.stringify(raw), new RegExp(token));
        await assert.rejects(
          qrCredentialModel.create({ profileId: id(), tokenDigest }),
          { code: 11000 },
        );
        await assert.rejects(
          qrCredentialModel.create({
            profileId,
            tokenDigest: generateQrToken().tokenDigest,
            state: "active",
          }),
          { code: 11000 },
        );
        await qrCredentialModel.create({
          profileId,
          tokenDigest: generateQrToken().tokenDigest,
        });
        await assert.rejects(qrCredentialModel.create({ profileId,
          tokenDigest: generateQrToken().tokenDigest }), { code: 11000 });
        const indexes = await qrCredentialModel.collection.indexes();
        assert.equal(indexes.find(index => index.name === "one_pending_qr_per_profile").unique, true);
        await qrCredentialModel.create({
          profileId,
          tokenDigest: generateQrToken().tokenDigest,
          state: "revoked",
        });
        await qrCredentialModel.create({
          profileId: id(),
          tokenDigest: generateQrToken().tokenDigest,
          state: "active",
        });
      },
    );
    await t.test("session expiry index and minimal audit records", async () => {
      const session = await authSessionModel.create({
        userId,
        expiresAt: new Date(Date.now() + 900000),
      });
      assert.equal(session.revokedAt, null);
      assert.equal(session.loginVersion, 0);
      await assert.rejects(new authSessionModel({ userId, expiresAt: new Date(), loginVersion: -1 }).validate());
      await assert.rejects(new authSessionModel({ userId, expiresAt: new Date(), loginVersion: 0.5 }).validate());
      const indexes = await authSessionModel.collection.indexes();
      assert.equal(
        indexes.find((index) => index.key.expiresAt).expireAfterSeconds,
        0,
      );
      const event = await auditEventModel.create({
        actorUserId: userId,
        profileId,
        action: "profile.created",
      });
      const raw = await auditEventModel.collection.findOne({ _id: event._id });
      assert.deepEqual(
        Object.keys(raw).sort(),
        [
          "_id",
          "__v",
          "action",
          "actorUserId",
          "createdAt",
          "profileId",
        ].sort(),
      );
    });
    await t.test(
      "explicit reset deletes only the prototype collection and preserves users/new profiles",
      async () => {
        // Isolated database for this destructive-script test.
        const dbName = `reset_test_${randomUUID().replaceAll("-", "")}`;
        const uri = process.env.TEST_MONGODB_URI.replace(
          /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/,
          `$1/${dbName}$2`,
        );
        assert.notEqual(uri, process.env.TEST_MONGODB_URI);
        const connection = await mongoose
          .createConnection(uri, { autoIndex: false })
          .asPromise();
        try {
          await connection
            .collection("users")
            .insertOne({ email: "preserve@example.com" });
          await connection
            .collection("emergencyprofiles")
            .insertOne({ bloodType: "O+" });
          const run = async (flags) => {
            const child = spawn(
              process.execPath,
              ["scripts/reset-prototype-profiles.js", ...flags],
              {
                env: {
                  ...process.env,
                  dbconnection: uri,
                  JWT_SECRET: "reset-tests-only-not-for-real-accounts",
                  PROFILE_ENCRYPTION_KEY: key,
                },
                stdio: ["ignore", "pipe", "pipe"],
              },
            );
            let output = "";
            child.stdout.on("data", (data) => (output += data));
            child.stderr.on("data", (data) => (output += data));
            const [code] = await once(child, "close");
            return { code, output };
          };
          assert.equal((await run([])).code, 1);
          assert.equal(
            await connection.collection("emergencyprofiles").countDocuments(),
            1,
          );
          const reset = await run(["--reset-prototype-profiles"]);
          assert.equal(reset.code, 0, reset.output);
          assert.equal(
            await connection.collection("users").countDocuments(),
            1,
          );
          assert.equal(
            await connection.db
              .listCollections({ name: "emergencyprofiles" })
              .hasNext(),
            false,
          );
          await connection
            .collection("emergency_profiles")
            .insertOne({ marker: "preserve-new-profile" });
          assert.equal((await run(["--reset-prototype-profiles"])).code, 0);
          assert.equal(
            await connection.collection("emergency_profiles").countDocuments(),
            1,
          );
        } finally {
          await connection.dropDatabase();
          await connection.close();
        }
      },
    );
  },
);
