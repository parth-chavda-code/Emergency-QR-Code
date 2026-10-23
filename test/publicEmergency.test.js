import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { eprofileModel } from "../backend/models/emergency_profile.js";
import { qrCredentialModel } from "../backend/models/qr_credential.js";
import { auditEventModel } from "../backend/models/audit_event.js";
import { generateQrToken } from "../backend/security/qrToken.js";
import { calculateAge } from "../backend/security/profileStorage.js";
import { encryptJson } from "../backend/security/profileEncryption.js";

const key = randomBytes(32).toString("hex");
const jwtSecret = randomBytes(32).toString("hex");
const password = "a unique public emergency test passphrase";
const unavailable = { error: "Emergency profile unavailable" };
const details = { displayName: "Public Person", dob: "1995-05-20", bloodType: "O+",
  allergies: ["Shared Allergy"], medicalCondition: ["Private Condition"], medications: ["Private Medicine"],
  emergencyContact: [{ name: "Private Contact", phone: "+919876543210", relation: "Friend" }],
  sharingConsent: { displayName: true, allergies: true } };

async function serve(t, encryptionKey = key) {
  const server = http.createServer(createApp({ jwtSecret, profileEncryptionKey: encryptionKey,
    publicBaseUrl: "https://qr.example.com" }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, path, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(base + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

function assertPrivacyHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("x-powered-by"), null);
}

test("malformed public tokens fail without a database and never expose their contents", async t => {
  const base = await serve(t);
  for (const token of ["short", "a".repeat(44), "!".repeat(43), "%E0%A4%A", "%24ne"]) {
    const result = await request(base, `/e/${token}`);
    assert.equal(result.response.status, 404);
    assert.deepEqual(result.body, unavailable);
    assertPrivacyHeaders(result.response);
  }
});

test("public requests are limited to 60 per minute, including attempts with spoofed IPs", async t => {
  const base = await serve(t);
  for (let i = 0; i < 60; i++) {
    assert.equal((await request(base, "/e/invalid", {
      headers: { "X-Forwarded-For": `203.0.113.${i + 1}` },
    })).response.status, 404);
  }
  const limited = await request(base, "/e/invalid");
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
  assertPrivacyHeaders(limited.response);
  assert.deepEqual(limited.body, { error: "Too many requests. Please try again later." });
  // Another app owns a separate limiter, and signup/login have their own limits.
  const otherBase = await serve(t);
  assert.equal((await request(otherBase, "/e/invalid")).response.status, 404);
  assert.equal((await request(base, "/user/login", { method: "POST", body: {} })).response.status, 400);
});

test("valid token fails safely when the database is disconnected", async t => {
  const base = await serve(t);
  const result = await request(base, `/e/${generateQrToken().token}`);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.headers.get("retry-after"), "5");
  assertPrivacyHeaders(result.response);
});

test("public emergency access with real MongoDB", {
  skip: !process.env.TEST_MONGODB_URI, timeout: 60000,
}, async t => {
  await connectDB(process.env.TEST_MONGODB_URI);
  t.after(disconnectDB);
  const hash = await bcrypt.hash(password, 10);

  async function fixture(t, data = details) {
    const base = await serve(t);
    const user = await userModel.create({ email: `public-${randomUUID()}@example.com`,
      firstName: "Public", lastName: "Test", password: hash });
    const login = await request(base, "/user/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.response.status, 200);
    const token = login.body.token;
    const created = await request(base, "/user/profile", { method: "POST", token, body: data });
    assert.equal(created.response.status, 201);
    const issued = await request(base, "/user/qr-credentials", { method: "POST", token, body: { profileRevision: 1 } });
    assert.equal(issued.response.status, 201);
    const credential = issued.body.credential;
    const publicPath = `/e/${issued.body.token}`;
    const activate = () => request(base, `/user/qr-credentials/${credential.id}/activate`, { method: "POST", token });
    const revoke = () => request(base, `/user/qr-credentials/${credential.id}/revoke`, { method: "POST", token });
    return { base, user, token, profile: created.body.profile, credential, publicPath, activate, revoke };
  }

  await t.test("additional information alone can issue a QR and consent changes update its public response", async t => {
    const text = "Example additional details\nAnother line";
    const f = await fixture(t, { displayName: "Example", dob: "1990-01-01", additionalInformation: text, sharingConsent: { additionalInformation: true } });
    assert.equal((await f.activate()).response.status, 200);
    const visible = await request(f.base, f.publicPath);
    assert.equal(visible.response.status, 200);
    assert.deepEqual(visible.body.publicProfile, { additionalInformation: text });
    const edited = await request(f.base, "/user/profile", { method: "PATCH", token: f.token, body: { revision: 1, sharingConsent: { additionalInformation: false } } });
    assert.equal(edited.response.status, 200);
    assert.equal((await request(f.base, f.publicPath)).response.status, 404);
  });

  await t.test("pending, unknown and revoked tokens have the same unavailable response", async t => {
    const f = await fixture(t);
    for (const path of [f.publicPath, `/e/${generateQrToken().token}`]) {
      const result = await request(f.base, path);
      assert.equal(result.response.status, 404);
      assert.deepEqual(result.body, unavailable);
      assertPrivacyHeaders(result.response);
    }
    await f.activate(); await f.revoke();
    const result = await request(f.base, f.publicPath);
    assert.equal(result.response.status, 404);
    assert.deepEqual(result.body, unavailable);
  });

  await t.test("active QR returns only consented categories without login or database writes", async t => {
    const f = await fixture(t); await f.activate();
    const before = await eprofileModel.collection.findOne({ _id: new mongoose.Types.ObjectId(f.profile.id) });
    const audits = await auditEventModel.countDocuments({ profileId: f.profile.id });
    const result = await request(f.base, f.publicPath, { headers: { Authorization: "Bearer invalid" } });
    assert.equal(result.response.status, 200);
    assertPrivacyHeaders(result.response);
    assert.deepEqual(result.body, { publicProfile: { displayName: "Public Person", allergies: ["Shared Allergy"] } });
    assert.doesNotMatch(JSON.stringify(result.body), /dob|1995-05-20|email|userId|profileId|token|revision|ciphertext|Private|919876543210/);
    assert.deepEqual(await eprofileModel.collection.findOne({ _id: before._id }), before);
    assert.equal(await auditEventModel.countDocuments({ profileId: f.profile.id }), audits);
  });

  await t.test("edits, whole-category consent withdrawal and sharing again affect the same link", async t => {
    const f = await fixture(t); await f.activate();
    const patch = async body => {
      const result = await request(f.base, "/user/profile", { method: "PATCH", token: f.token, body });
      assert.equal(result.response.status, 200);
    };
    await patch({ revision: 1, medications: ["Medicine One", "Medicine Two"],
      sharingConsent: { medications: true, allergies: false } });
    assert.deepEqual((await request(f.base, f.publicPath)).body.publicProfile,
      { displayName: "Public Person", medications: ["Medicine One", "Medicine Two"] });
    await patch({ revision: 2, sharingConsent: { displayName: false, medications: false } });
    const hidden = await request(f.base, f.publicPath);
    assert.equal(hidden.response.status, 404); assert.deepEqual(hidden.body, unavailable);
    assert.equal((await qrCredentialModel.findById(f.credential.id)).state, "active");
    await patch({ revision: 3, sharingConsent: { age: true, emergencyContact: true } });
    assert.deepEqual((await request(f.base, f.publicPath)).body, { publicProfile: {
      age: calculateAge(details.dob), emergencyContact: details.emergencyContact,
    } });
  });

  await t.test("age zero is public only with age consent; DOB never appears", async t => {
    const f = await fixture(t, { displayName: "Private Newborn", dob: new Date().toISOString().slice(0, 10),
      sharingConsent: { age: true } });
    await f.activate();
    assert.deepEqual((await request(f.base, f.publicPath)).body, { publicProfile: { age: 0 } });
  });

  await t.test("all shared categories match the owner's preview, while an empty shared category alone is unavailable", async t => {
    const data = { ...details, sharingConsent: { displayName: true, age: true, bloodType: true,
      allergies: true, medicalCondition: true, medications: true, emergencyContact: true } };
    const f = await fixture(t, data); await f.activate();
    const preview = await request(f.base, "/user/profile/public-preview", { token: f.token });
    const result = await request(f.base, f.publicPath);
    assert.deepEqual(result.body, { publicProfile: preview.body.publicProfile });
    assert.deepEqual(Object.keys(result.body.publicProfile).sort(), Object.keys(data.sharingConsent).sort());
    assert.equal(result.body.publicProfile.dob, undefined);
    const edit = await request(f.base, "/user/profile", { method: "PATCH", token: f.token,
      body: { revision: 1, allergies: [], sharingConsent: { displayName: false, age: false,
        bloodType: false, medicalCondition: false, medications: false, emergencyContact: false } } });
    assert.equal(edit.response.status, 200);
    const empty = await request(f.base, f.publicPath);
    assert.equal(empty.response.status, 404);
    assert.deepEqual(empty.body, unavailable);
  });

  await t.test("private DOB is decrypted only when age is shared", async t => {
    const f = await fixture(t); await f.activate();
    await eprofileModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.profile.id) },
      { $set: { "privatePayload.tag": "AA==" } });
    assert.equal((await request(f.base, f.publicPath)).response.status, 200);
    await eprofileModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.profile.id) },
      { $set: { "sharingConsent.age": true } });
    const failed = await request(f.base, f.publicPath);
    assert.equal(failed.response.status, 500);
    assert.deepEqual(failed.body, { error: "Internal server error" });
  });

  await t.test("replacement disables the old link, and logout leaves the active public QR usable", async t => {
    const f = await fixture(t); await f.activate();
    const issued = await request(f.base, "/user/qr-credentials", { method: "POST", token: f.token,
      body: { profileRevision: 1 } });
    const nextPath = `/e/${issued.body.token}`;
    assert.equal((await request(f.base, f.publicPath)).response.status, 200);
    assert.equal((await request(f.base, nextPath)).response.status, 404);
    assert.equal((await request(f.base, `/user/qr-credentials/${issued.body.credential.id}/activate`,
      { method: "POST", token: f.token })).response.status, 200);
    assert.equal((await request(f.base, f.publicPath)).response.status, 404);
    assert.equal((await request(f.base, nextPath)).response.status, 200);
    assert.equal((await request(f.base, "/user/logout", { method: "POST", token: f.token })).response.status, 204);
    assert.equal((await request(f.base, nextPath)).response.status, 200);
  });

  await t.test("missing profiles and deleted accounts make links unavailable", async t => {
    const f = await fixture(t); await f.activate();
    await userModel.deleteOne({ _id: f.user._id });
    assert.deepEqual((await request(f.base, f.publicPath)).body, unavailable);
    await eprofileModel.deleteOne({ _id: f.profile.id });
    const result = await request(f.base, f.publicPath);
    assert.equal(result.response.status, 404); assert.deepEqual(result.body, unavailable);
  });

  await t.test("database and unexpected failures use safe errors without logging the URL", async t => {
    const f = await fixture(t); await f.activate();
    for (const model of [qrCredentialModel, eprofileModel, userModel]) {
      const method = model === eprofileModel ? "findById" : model === userModel ? "exists" : "findOne";
      const mock = t.mock.method(model, method, () => { throw Object.assign(new Error("secret database details"), { name: "MongoNetworkError" }); });
      const result = await request(f.base, f.publicPath);
      assert.equal(result.response.status, 503);
      assert.equal(result.response.headers.get("retry-after"), "5");
      assertPrivacyHeaders(result.response);
      assert.doesNotMatch(JSON.stringify(result.body), /secret|mongodb|token/);
      mock.mock.restore();
    }
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));
    const mock = t.mock.method(qrCredentialModel, "findOne", () => { throw new Error(f.publicPath); });
    const failure = await request(f.base, f.publicPath);
    assert.equal(failure.response.status, 500);
    assert.deepEqual(failure.body, { error: "Internal server error" });
    assertPrivacyHeaders(failure.response);
    assert.deepEqual(logs, ["Unexpected request failure"]);
    mock.mock.restore();
  });

  await t.test("wrong keys, tampered ciphertext and invalid decrypted contact fields fail closed", async t => {
    const f = await fixture(t); await f.activate();
    const otherBase = await serve(t, randomBytes(32).toString("hex"));
    assert.equal((await request(otherBase, f.publicPath)).response.status, 500);
    const profile = await eprofileModel.findById(f.profile.id).select("+publicSnapshot").lean();
    const bytes = Buffer.from(profile.publicSnapshot.ciphertext, "base64"); bytes[0] ^= 1;
    await eprofileModel.collection.updateOne({ _id: profile._id }, { $set: { "publicSnapshot.ciphertext": bytes.toString("base64") } });
    assert.equal((await request(f.base, f.publicPath)).response.status, 500);
    const invalid = encryptJson({ emergencyContact: [{ name: "Contact", phone: "+919876543210", dob: "private" }] }, key, `${profile._id}:public`);
    await eprofileModel.collection.updateOne({ _id: profile._id }, { $set: { publicSnapshot: invalid,
      "sharingConsent.emergencyContact": true } });
    const failed = await request(f.base, f.publicPath);
    assert.equal(failed.response.status, 500);
    assert.deepEqual(failed.body, { error: "Internal server error" });
  });
});
