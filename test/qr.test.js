import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { eprofileModel } from "../backend/models/emergency_profile.js";
import { qrCredentialModel } from "../backend/models/qr_credential.js";
import { auditEventModel } from "../backend/models/audit_event.js";
import { digestQrToken } from "../backend/security/qrToken.js";
import { hasSharedInformation } from "../backend/security/qrCredentials.js";
import { issueQrSchema, qrListSchema, credentialIdSchema } from "../backend/validation/qr.js";

const secret = randomBytes(32).toString("hex");
const key = randomBytes(32).toString("hex");
const origin = "https://qr.example.com";
const password = "a unique QR lifecycle test passphrase!";
const profileData = { displayName: "QR Owner", dob: "1995-05-20", medications: ["Private Medicine"],
  emergencyContact: [{ name: "Private Contact", phone: "+919876543210" }], sharingConsent: { displayName: true } };
const path = "/user/qr-credentials";
const id = () => new mongoose.Types.ObjectId().toString();

async function serve(t) {
  const server = http.createServer(createApp({ jwtSecret: secret, profileEncryptionKey: key, publicBaseUrl: origin }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, method, url = path, token, body, { headers = {}, raw } = {}) {
  const response = await fetch(base + url, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

function assertMetadataOnly(value) {
  assert.doesNotMatch(JSON.stringify(value), /tokenDigest|qrUrl|\/e\/|Private Medicine|Private Contact|1995-05-20|919876543210/);
  const credentials = value.credentials ?? [value.credential];
  for (const credential of credentials) assert.deepEqual(Object.keys(credential).sort(),
    ["id", "state", "replacesCredentialId", "createdAt", "updatedAt", "activatedAt", "revokedAt"].sort());
}

test("QR schemas reject untrusted fields and pagination inputs; age zero counts as shared", () => {
  assert.deepEqual(qrListSchema.parse({}), { limit: 20 });
  assert.deepEqual(qrListSchema.parse({ limit: "2", cursor: id() }).limit, 2);
  for (const value of [{ limit: "0" }, { limit: "51" }, { limit: "1.5" }, { limit: ["1", "2"] },
    { cursor: "bad" }, { userId: id() }]) assert.equal(qrListSchema.safeParse(value).success, false);
  for (const value of [{}, { profileRevision: "1" }, { profileRevision: 0 }, { profileRevision: 1, token: "raw" },
    { profileRevision: 1, state: "active" }, { profileRevision: 1, userId: id() }]) {
    assert.equal(issueQrSchema.safeParse(value).success, false);
  }
  assert.equal(credentialIdSchema.safeParse("$ne").success, false);
  assert.equal(hasSharedInformation({}), false);
  assert.equal(hasSharedInformation({ allergies: [], displayName: " " }), false);
  assert.equal(hasSharedInformation({ age: 0 }), true);
});

test("QR management requires authentication; invalid public tokens are unavailable", async t => {
  const base = await serve(t);
  for (const [method, url] of [["GET", path], ["POST", path], ["GET", "/user/profile/public-preview"],
    ["POST", `${path}/${id()}/activate`], ["POST", `${path}/${id()}/revoke`]]) {
    const result = await request(base, method, url);
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  }
  const publicResult = await request(base, "GET", "/e/untrusted-token");
  assert.equal(publicResult.response.status, 404);
  assert.deepEqual(publicResult.body, { error: "Emergency profile unavailable" });
});

test("QR lifecycle with transaction-capable MongoDB", { skip: !process.env.TEST_MONGODB_URI, timeout: 120000 }, async t => {
  await connectDB(process.env.TEST_MONGODB_URI);
  t.after(disconnectDB);
  const hash = await bcrypt.hash(password, 10);
  async function owner(base, data = profileData) {
    const user = await userModel.create({ email: `qr-${randomUUID()}@example.com`, firstName: "QR", lastName: "Test", password: hash });
    const login = await request(base, "POST", "/user/login", undefined, { email: user.email, password });
    assert.equal(login.response.status, 200);
    let profile;
    if (data) {
      const created = await request(base, "POST", "/user/profile", login.body.token, data);
      assert.equal(created.response.status, 201);
      profile = created.body.profile;
    }
    return { user, token: login.body.token, profile };
  }
  async function issue(base, token, revision = 1) {
    const result = await request(base, "POST", path, token, { profileRevision: revision });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  const activate = (base, token, credentialId) => request(base, "POST", `${path}/${credentialId}/activate`, token);
  const revoke = (base, token, credentialId) => request(base, "POST", `${path}/${credentialId}/revoke`, token);

  await t.test("preview, one-time issuance, digest-only storage, limits and initial activation", async t => {
    const base = await serve(t); const { token, profile, user } = await owner(base);
    const before = await eprofileModel.collection.findOne({ userId: user._id });
    const preview = await request(base, "GET", "/user/profile/public-preview", token);
    assert.deepEqual(preview.body, { publicProfile: { displayName: "QR Owner" }, profileRevision: 1, hasSharedInformation: true });
    const first = await issue(base, token);
    assert.equal(first.credential.state, "pending");
    assert.equal(first.credential.replacesCredentialId, null);
    assert.equal(first.qrUrl, `${origin}/e/${first.token}`);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    const record = await qrCredentialModel.collection.findOne({ _id: new mongoose.Types.ObjectId(first.credential.id) });
    assert.equal(record.tokenDigest, digestQrToken(first.token));
    assert.equal(record.token, undefined);
    assert.equal(record.qrUrl, undefined);
    assert.equal(JSON.stringify(record).includes(first.token), false);
    assert.equal((await qrCredentialModel.findById(record._id).lean()).tokenDigest, undefined);
    assert.equal((await request(base, "POST", path, token, { profileRevision: 1 })).response.status, 409);
    const listing = await request(base, "GET", path, token);
    assert.equal(listing.response.status, 200);
    assert.equal(listing.body.credentials.length, 1);
    assertMetadataOnly(listing.body);
    const activated = await activate(base, token, first.credential.id);
    assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.credential.state, "active");
    assert.ok(activated.body.credential.activatedAt);
    assertMetadataOnly(activated.body);
    const repeat = await activate(base, token, first.credential.id);
    assert.deepEqual(repeat.body, activated.body);
    const after = await eprofileModel.collection.findOne({ userId: user._id });
    assert.equal(after.revision, 1);
    assert.deepEqual(after.updatedAt, before.updatedAt);
    assert.deepEqual(after.privatePayload, before.privatePayload);
    assert.deepEqual(after.publicSnapshot, before.publicSnapshot);
    assert.equal((await request(base, "GET", "/user/profile", token)).body.profile.qrChangeVersion, undefined);
    const events = await auditEventModel.find({ profileId: new mongoose.Types.ObjectId(profile.id), action: /^qr\./ }).lean();
    assert.deepEqual(events.map(event => event.action).sort(), ["qr.activated", "qr.issued"]);
    for (const secretValue of [first.token, first.qrUrl, record.tokenDigest, password, profileData.dob]) {
      assert.equal(JSON.stringify(events).includes(secretValue), false);
    }
  });

  await t.test("planned replacement atomically revokes old QR and revoked QR never reactivates", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    const first = await issue(base, token);
    assert.equal((await activate(base, token, first.credential.id)).response.status, 200);
    const second = await issue(base, token);
    assert.equal(second.credential.replacesCredentialId, first.credential.id);
    const before = await request(base, "GET", path, token);
    assert.equal(before.body.credentials.find(c => c.id === first.credential.id).state, "active");
    assert.equal(second.credential.state, "pending");
    assert.equal((await activate(base, token, second.credential.id)).response.status, 200);
    const records = await qrCredentialModel.find({ profileId: profile.id }).lean();
    assert.equal(records.filter(c => c.state === "active").length, 1);
    assert.equal(records.find(c => c._id.toString() === first.credential.id).state, "revoked");
    assert.equal((await activate(base, token, first.credential.id)).response.status, 409);
    const next = await issue(base, token);
    assert.equal(next.credential.replacesCredentialId, second.credential.id);
  });

  await t.test("urgent revocation and lost pending download allow a fresh replacement", async t => {
    const base = await serve(t); const { token } = await owner(base);
    const first = await issue(base, token);
    await activate(base, token, first.credential.id);
    const pending = await issue(base, token);
    const revoked = await revoke(base, token, first.credential.id);
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.credential.state, "revoked");
    assert.deepEqual((await revoke(base, token, first.credential.id)).body, revoked.body);
    assert.equal((await activate(base, token, pending.credential.id)).response.status, 200);
    const lost = await issue(base, token);
    assert.equal((await revoke(base, token, lost.credential.id)).response.status, 200);
    assert.equal((await activate(base, token, lost.credential.id)).response.status, 409);
    const replacement = await issue(base, token);
    assert.notEqual(replacement.token, lost.token);
  });

  await t.test("private/empty categories block issue and activation; newborn age is sufficient", async t => {
    const base = await serve(t);
    const empty = await owner(base, { displayName: "Private", dob: "2000-01-01", allergies: [], sharingConsent: { allergies: true } });
    assert.equal((await request(base, "GET", "/user/profile/public-preview", empty.token)).body.hasSharedInformation, false);
    assert.equal((await request(base, "POST", path, empty.token, { profileRevision: 1 })).response.status, 409);
    const normal = await owner(base);
    const issued = await issue(base, normal.token);
    const edit = await request(base, "PATCH", "/user/profile", normal.token,
      { revision: 1, sharingConsent: { displayName: false } });
    assert.equal(edit.response.status, 200);
    assert.equal((await activate(base, normal.token, issued.credential.id)).response.status, 409);
    const newborn = await owner(base, { displayName: "Private Newborn", dob: new Date().toISOString().slice(0, 10), sharingConsent: { age: true } });
    const preview = await request(base, "GET", "/user/profile/public-preview", newborn.token);
    assert.deepEqual(preview.body.publicProfile, { age: 0 });
    assert.equal(preview.body.publicProfile.dob, undefined);
    assert.equal((await issue(base, newborn.token)).credential.state, "pending");
  });

  await t.test("stale previews fail, while consent changes preserve the active credential", async t => {
    const base = await serve(t); const { token } = await owner(base);
    const first = await issue(base, token);
    await activate(base, token, first.credential.id);
    await request(base, "PATCH", "/user/profile", token, { revision: 1, sharingConsent: { displayName: false } });
    const hidden = await request(base, "GET", "/user/profile/public-preview", token);
    assert.deepEqual(hidden.body.publicProfile, {});
    assert.equal((await request(base, "GET", path, token)).body.credentials[0].state, "active");
    await request(base, "PATCH", "/user/profile", token, { revision: 2, sharingConsent: { displayName: true } });
    assert.equal((await request(base, "POST", path, token, { profileRevision: 1 })).response.status, 409);
    assert.equal((await issue(base, token, 3)).credential.replacesCredentialId, first.credential.id);
  });

  await t.test("owner isolation, nonexistent profiles and foreign credential IDs", async t => {
    const base = await serve(t); const a = await owner(base); const b = await owner(base);
    const noProfile = await owner(base, null);
    const first = await issue(base, a.token);
    for (const action of [activate, revoke]) {
      assert.equal((await action(base, b.token, first.credential.id)).response.status, 404);
      assert.equal((await action(base, b.token, id())).response.status, 404);
      assert.equal((await action(base, noProfile.token, first.credential.id)).response.status, 404);
    }
    assert.deepEqual((await request(base, "GET", path, b.token)).body.credentials, []);
    assert.equal((await request(base, "GET", `${path}?userId=${a.user._id}`, b.token)).response.status, 400);
    for (const url of [path, "/user/profile/public-preview"]) assert.equal((await request(base, "GET", url, noProfile.token)).response.status, 404);
    assert.equal((await request(base, "POST", path, noProfile.token, { profileRevision: 1 })).response.status, 404);
    const foreignPreview = await request(base, "GET", `/user/profile/public-preview?userId=${a.user._id}`, b.token);
    assert.equal(foreignPreview.body.profileRevision, b.profile.revision);
  });

  await t.test("bounded pagination returns metadata only and never re-downloads tokens", async t => {
    const base = await serve(t); const { token } = await owner(base);
    const issued = [];
    for (let i = 0; i < 3; i++) { const c = await issue(base, token); issued.push(c); await revoke(base, token, c.credential.id); }
    const first = await request(base, "GET", `${path}?limit=2`, token);
    assert.equal(first.body.credentials.length, 2); assert.ok(first.body.nextCursor);
    const second = await request(base, "GET", `${path}?limit=2&cursor=${first.body.nextCursor}`, token);
    assert.equal(second.body.credentials.length, 1); assert.equal(second.body.nextCursor, null);
    assert.equal(new Set([...first.body.credentials, ...second.body.credentials].map(c => c.id)).size, 3);
    assertMetadataOnly(first.body); assertMetadataOnly(second.body);
    for (const c of issued) assert.equal(JSON.stringify(first.body).includes(c.token), false);
  });

  await t.test("invalid IDs, bodies, encodings, and list inputs fail without mutating QR records", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    for (const body of [{}, { profileRevision: 0 }, { profileRevision: "1" }, { profileRevision: 1, state: "active" },
      { profileRevision: 1, userId: id() }, { profileRevision: 1, token: "raw" }]) {
      assert.equal((await request(base, "POST", path, token, body)).response.status, 400);
    }
    assert.equal((await request(base, "POST", path, token, { profileRevision: 1 }, { headers: { "Content-Type": "text/plain" } })).response.status, 415);
    for (const [raw, status] of [["{", 400], [JSON.stringify({ huge: "x".repeat(17000) }), 413]]) {
      assert.equal((await request(base, "POST", path, token, undefined, { raw })).response.status, status);
    }
    for (const query of ["limit=0", "limit=51", "cursor=bad", "limit=1&limit=2"]) {
      assert.equal((await request(base, "GET", `${path}?${query}`, token)).response.status, 400);
    }
    assert.equal((await activate(base, token, "invalid")).response.status, 400);
    assert.equal((await revoke(base, token, "invalid")).response.status, 400);
    assert.equal(await qrCredentialModel.countDocuments({ profileId: profile.id }), 0);
    const issued = await issue(base, token);
    assert.equal((await request(base, "POST", `${path}/${issued.credential.id}/activate`, token, { state: "active" })).response.status, 400);
    assert.equal((await request(base, "POST", `${path}/${issued.credential.id}/revoke`, token, {}, { headers: { "Content-Type": "text/plain" } })).response.status, 415);
    assert.equal((await request(base, "POST", `${path}/${issued.credential.id}/activate`, token, {})).response.status, 200);
  });

  await t.test("simultaneous issuance creates one pending credential, and repeated activation is safe", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    const results = await Promise.all([request(base, "POST", path, token, { profileRevision: 1 }), request(base, "POST", path, token, { profileRevision: 1 })]);
    assert.deepEqual(results.map(r => r.response.status).sort(), [201, 409]);
    assert.equal(await qrCredentialModel.countDocuments({ profileId: profile.id, state: "pending" }), 1);
    const winner = results.find(r => r.response.status === 201).body;
    const activated = await Promise.all([activate(base, token, winner.credential.id), activate(base, token, winner.credential.id)]);
    assert.deepEqual(activated.map(r => r.response.status), [200, 200]);
    assert.equal(await qrCredentialModel.countDocuments({ profileId: profile.id, state: "active" }), 1);
    assert.equal(await auditEventModel.countDocuments({ profileId: profile.id, action: "qr.activated" }), 1);
  });

  await t.test("concurrent activation/revocation never resurrects a revoked QR", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    const issued = await issue(base, token);
    const [activated, revoked] = await Promise.all([activate(base, token, issued.credential.id), revoke(base, token, issued.credential.id)]);
    assert.ok([200, 409].includes(activated.response.status)); assert.equal(revoked.response.status, 200);
    assert.equal((await qrCredentialModel.findById(issued.credential.id)).state, "revoked");
    assert.equal(await qrCredentialModel.countDocuments({ profileId: profile.id, state: "active" }), 0);
  });

  await t.test("concurrent consent withdrawal and activation preserve privacy and profile edits", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    const issued = await issue(base, token);
    const [activated, edited] = await Promise.all([activate(base, token, issued.credential.id),
      request(base, "PATCH", "/user/profile", token, { revision: 1, sharingConsent: { displayName: false } })]);
    assert.ok([200, 409].includes(activated.response.status), JSON.stringify(activated.body));
    assert.equal(edited.response.status, 200);
    const preview = await request(base, "GET", "/user/profile/public-preview", token);
    assert.deepEqual(preview.body.publicProfile, {}); assert.equal(preview.body.profileRevision, 2);
    assert.ok(await qrCredentialModel.countDocuments({ profileId: profile.id, state: "active" }) <= 1);
  });

  await t.test("failed replacement rolls back revocation, activation, counter, and audit writes", async t => {
    const base = await serve(t); const { token, profile, user } = await owner(base);
    const first = await issue(base, token); await activate(base, token, first.credential.id);
    const second = await issue(base, token);
    const before = await eprofileModel.collection.findOne({ userId: user._id });
    const auditCount = await auditEventModel.countDocuments({ profileId: profile.id });
    t.mock.method(qrCredentialModel, "findOneAndUpdate", () => { throw new Error("private token and medical details"); });
    const result = await activate(base, token, second.credential.id);
    assert.equal(result.response.status, 500); assert.deepEqual(result.body, { error: "Internal server error" });
    assert.equal((await qrCredentialModel.findById(first.credential.id)).state, "active");
    assert.equal((await qrCredentialModel.findById(second.credential.id)).state, "pending");
    assert.deepEqual(await eprofileModel.collection.findOne({ userId: user._id }), before);
    assert.equal(await auditEventModel.countDocuments({ profileId: profile.id }), auditCount);
  });

  await t.test("audit write failure rolls back QR mutation and does not report false success", async t => {
    const base = await serve(t); const { token } = await owner(base);
    const issued = await issue(base, token); await activate(base, token, issued.credential.id);
    t.mock.method(auditEventModel, "create", () => { throw new Error("private audit details"); });
    const failed = await revoke(base, token, issued.credential.id);
    assert.equal(failed.response.status, 500); assert.deepEqual(failed.body, { error: "Internal server error" });
    assert.equal((await qrCredentialModel.findById(issued.credential.id)).state, "active");
  });

  await t.test("database, encryption and uncertain-commit failures return safe errors without token leaks", async t => {
    const base = await serve(t); const { token, profile } = await owner(base);
    const original = mongoose.connection.transaction;
    const failure = t.mock.method(mongoose.connection, "transaction", async () => {
      const error = new Error("private transaction details"); error.name = "MongoNetworkError"; throw error;
    });
    const failed = await request(base, "POST", path, token, { profileRevision: 1 });
    assert.equal(failed.response.status, 503); assert.equal(failed.response.headers.get("retry-after"), "5");
    assert.equal(failed.body.token, undefined); assert.doesNotMatch(JSON.stringify(failed.body), /private/);
    failure.mock.restore();
    const uncertain = t.mock.method(mongoose.connection, "transaction", async () => {
      const error = new Error("private commit details"); error.hasErrorLabel = label => label === "UnknownTransactionCommitResult"; throw error;
    });
    assert.equal((await request(base, "POST", path, token, { profileRevision: 1 })).response.status, 503);
    uncertain.mock.restore();
    assert.equal(mongoose.connection.transaction, original);
    const record = await eprofileModel.collection.findOne({ _id: new mongoose.Types.ObjectId(profile.id) });
    const changed = Buffer.from(record.publicSnapshot.tag, "base64"); changed[0] ^= 1;
    await eprofileModel.collection.updateOne({ _id: record._id }, { $set: { "publicSnapshot.tag": changed.toString("base64") } });
    const preview = await request(base, "GET", "/user/profile/public-preview", token);
    assert.equal(preview.response.status, 500); assert.deepEqual(preview.body, { error: "Internal server error" });
    assert.equal((await request(base, "POST", path, token, { profileRevision: 1 })).response.status, 500);
    assert.equal(await qrCredentialModel.countDocuments({ profileId: profile.id }), 0);
  });

  await t.test("invalidated sessions cannot manage QR credentials", async t => {
    const base = await serve(t); const { token } = await owner(base);
    const issued = await issue(base, token);
    assert.equal((await request(base, "POST", "/user/logout", token)).response.status, 204);
    for (const [method, url, body] of [["GET", path], ["POST", path, { profileRevision: 1 }],
      ["POST", `${path}/${issued.credential.id}/activate`], ["POST", `${path}/${issued.credential.id}/revoke`],
      ["GET", "/user/profile/public-preview"]]) assert.equal((await request(base, method, url, token, body)).response.status, 401);
  });

  await t.test("standalone MongoDB safely rejects mutations but still supports auth, profiles, preview and lists", {
    skip: !process.env.TEST_STANDALONE_URI,
  }, async t => {
    // Separate process: do not reuse already-initialized Mongoose models on another database.
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import http from 'node:http';
      import {createApp} from './backend/app.js';
      import {connectDB,disconnectDB} from './backend/db.js';
      await connectDB(process.env.TEST_STANDALONE_URI);
      const server=http.createServer(createApp({jwtSecret:process.env.QR_TEST_SECRET,
        profileEncryptionKey:process.env.QR_TEST_KEY,publicBaseUrl:process.env.QR_TEST_ORIGIN}));
      server.listen(0,'127.0.0.1',()=>console.log('READY:'+server.address().port));
      process.once('SIGTERM',()=>server.close(async()=>{await disconnectDB();}));
    `], { env: { ...process.env, QR_TEST_SECRET: secret, QR_TEST_KEY: key, QR_TEST_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(child, "close");
    t.after(async () => {
      child.kill("SIGTERM");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await closed; } finally { clearTimeout(deadline); }
    });
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", data => {
        output += data;
        const match = output.match(/READY:(\d+)/);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Standalone test backend exited before startup")));
    });
    const email = `standalone-${randomUUID()}@example.com`;
    assert.equal((await request(base, "POST", "/user/signup", undefined,
      { email, password, firstName: "Standalone", lastName: "Test" })).response.status, 201);
    const login = await request(base, "POST", "/user/login", undefined, { email, password });
    const token = login.body.token;
    assert.equal((await request(base, "POST", "/user/profile", token, profileData)).response.status, 201);
    for (const [url, body] of [[path, { profileRevision: 1 }], [`${path}/${id()}/activate`], [`${path}/${id()}/revoke`]]) {
      const result = await request(base, "POST", url, token, body);
      assert.equal(result.response.status, 503); assert.equal(result.response.headers.get("retry-after"), "5");
    }
    assert.equal((await request(base, "GET", "/user/profile/public-preview", token)).response.status, 200);
    assert.equal((await request(base, "GET", path, token)).response.status, 200);
    assert.deepEqual((await request(base, "GET", path, token)).body.credentials, []);
  });
});
