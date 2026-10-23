import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { eprofileModel } from "../backend/models/emergency_profile.js";
import { auditEventModel } from "../backend/models/audit_event.js";
import { profileSchema, profileUpdateSchema, sharingCategories } from "../backend/validation/profile.js";
import { readPublicSnapshot } from "../backend/security/profileStorage.js";

const secret = randomBytes(32).toString("hex");
const key = randomBytes(32).toString("hex");
const basic = { displayName: "Profile Owner", dob: "1995-05-20" };
const password = "a unique profile test passphrase";

async function serve(t, encryptionKey = key) {
  const server = http.createServer(createApp({ jwtSecret: secret, profileEncryptionKey: encryptionKey }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, method, body, token, { path = "/user/profile", headers = {}, raw } = {}) {
  const response = await fetch(base + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

test("profile PATCH preserves omission and rejects empty, invalid or unexpected changes", () => {
  assert.deepEqual(profileUpdateSchema.parse({ revision: 1, medications: [] }), { revision: 1, medications: [] });
  assert.deepEqual(profileUpdateSchema.parse({ revision: 1, sharingConsent: { age: true } }),
    { revision: 1, sharingConsent: { age: true } });
  assert.equal(profileUpdateSchema.parse({ revision: 1, bloodType: null }).bloodType, null);
  for (const body of [{}, { revision: 1 }, { revision: 1, sharingConsent: {} },
    { medications: [] }, { revision: "1", medications: [] }, { revision: 0, medications: [] },
    { revision: 1.5, medications: [] }, { revision: Number.MAX_SAFE_INTEGER, medications: [] },
    { revision: 1, displayName: null }, { revision: 1, dob: null }, { revision: 1, dob: "2023-02-29" },
    { revision: 1, dob: "9999-01-01" }, { revision: 1, bloodType: "unknown" },
    { revision: 1, sharingConsent: { age: "true" } }, { revision: 1, sharingConsent: { dob: true } },
    { revision: 1, userId: "another-user" }, { revision: 1, privatePayload: {} },
    { revision: 1, medications: null }, { revision: 1, medications: [""] },
    { revision: 1, emergencyContact: [{ name: "Contact", phone: "bad-number" }] }]) {
    assert.equal(profileUpdateSchema.safeParse(body).success, false);
  }
  assert.equal(profileSchema.safeParse({ ...basic, bloodType: null }).success, false);
  assert.equal(profileSchema.safeParse({ ...basic,
    medications: Array(30).fill("界".repeat(500)), allergies: Array(30).fill("界".repeat(500)) }).success, false);
});

test("profile endpoints require authentication; old and unimplemented routes stay inactive", async t => {
  const base = await serve(t);
  for (const method of ["GET", "POST", "PATCH"]) {
    const result = await request(base, method, method === "GET" ? undefined : basic);
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  }
  for (const [method, path] of [["POST", "/profile/create"], ["PUT", "/profile/update"],
    ["GET", "/emergency/token"], ["GET", "/health"], ["DELETE", "/user/profile"],
    ["PUT", "/user/profile"], ["POST", "/user/profile/create"]]) {
    assert.equal((await request(base, method, undefined, undefined, { path })).response.status, 404);
  }
});

test("owner profile endpoints with real MongoDB", { skip: !process.env.TEST_MONGODB_URI, timeout: 60000 }, async t => {
  await connectDB(process.env.TEST_MONGODB_URI);
  t.after(disconnectDB);
  const hash = await bcrypt.hash(password, 10);
  async function login(base) {
    const user = await userModel.create({ email: `profile-${randomUUID()}@example.com`,
      firstName: "Profile", lastName: "Test", password: hash });
    const result = await request(base, "POST", { email: user.email, password }, undefined, { path: "/user/login" });
    assert.equal(result.response.status, 200);
    return { user, token: result.body.token };
  }

  await t.test("create/read a minimal private profile with explicit owner-only fields", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    const created = await request(base, "POST", basic, token);
    assert.equal(created.response.status, 201);
    assert.equal(created.response.headers.get("cache-control"), "no-store");
    const profile = created.body.profile;
    assert.equal(profile.displayName, basic.displayName);
    assert.equal(profile.dob, basic.dob);
    assert.equal(profile.revision, 1);
    assert.ok(Number.isFinite(Date.parse(profile.createdAt)));
    assert.ok(Number.isFinite(Date.parse(profile.updatedAt)));
    for (const category of sharingCategories) assert.equal(profile.sharingConsent[category], false);
    for (const category of ["allergies", "medicalCondition", "medications", "emergencyContact"]) assert.deepEqual(profile[category], []);
    assert.deepEqual(Object.keys(profile).sort(), ["id", "displayName", "dob", "allergies", "medicalCondition",
      "medications", "additionalInformation", "emergencyContact", "sharingConsent", "revision", "createdAt", "updatedAt"].sort());
    const read = await request(base, "GET", undefined, token);
    assert.equal(read.response.status, 200);
    assert.deepEqual(read.body, created.body);
    const record = await eprofileModel.collection.findOne({ userId: user._id });
    assert.doesNotMatch(JSON.stringify(record), /Profile Owner|1995-05-20/);
    assert.deepEqual(readPublicSnapshot(record, key), {});
    assert.equal((await request(base, "POST", basic, token)).response.status, 409);
    assert.equal(await eprofileModel.countDocuments({ userId: user._id }), 1);
    const event = await auditEventModel.findOne({ actorUserId: user._id, action: "profile.created" }).lean();
    assert.equal(event.profileId.toString(), profile.id);
  });

  await t.test("additional information saves encrypted and supports independent sharing and clearing", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    const text = "Additional private details\nSecond line";
    const created = await request(base, "POST", { ...basic, additionalInformation: text }, token);
    assert.equal(created.response.status, 201);
    assert.equal(created.body.profile.additionalInformation, text);
    let record = await eprofileModel.collection.findOne({ userId: user._id });
    assert.doesNotMatch(JSON.stringify(record), /Additional private details/);
    assert.deepEqual(readPublicSnapshot(record, key), {});
    const shared = await request(base, "PATCH", { revision: 1, sharingConsent: { additionalInformation: true } }, token);
    assert.equal(shared.response.status, 200);
    record = await eprofileModel.collection.findOne({ userId: user._id });
    assert.deepEqual(readPublicSnapshot(record, key), { additionalInformation: text });
    assert.equal((await request(base, "PATCH", { revision: 2, additionalInformation: "x".repeat(1001) }, token)).response.status, 400);
    const cleared = await request(base, "PATCH", { revision: 2, additionalInformation: "" }, token);
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.profile.additionalInformation, "");
    record = await eprofileModel.collection.findOne({ userId: user._id });
    assert.deepEqual(readPublicSnapshot(record, key), {});
  });

  await t.test("partial updates preserve other data/consent and replace or clear entire categories", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    const details = { ...basic, bloodType: "O+", allergies: ["Private Allergy"],
      medicalCondition: ["Condition One", "Condition Two"], medications: ["Old Medicine"],
      emergencyContact: [{ name: "Contact Person", phone: "+919876543210", relation: "Friend" }],
      sharingConsent: { displayName: true, medicalCondition: true, age: true } };
    assert.equal((await request(base, "POST", details, token)).response.status, 201);
    const edited = await request(base, "PATCH", { revision: 1, medications: ["New Medicine"],
      sharingConsent: { medications: true } }, token);
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.profile.revision, 2);
    assert.equal(edited.body.profile.bloodType, "O+");
    assert.deepEqual(edited.body.profile.allergies, details.allergies);
    assert.deepEqual(edited.body.profile.emergencyContact, details.emergencyContact);
    assert.equal(edited.body.profile.sharingConsent.displayName, true);
    assert.equal(edited.body.profile.sharingConsent.medicalCondition, true);
    assert.equal(edited.body.profile.sharingConsent.medications, true);
    const record = await eprofileModel.collection.findOne({ userId: user._id });
    const shared = readPublicSnapshot(record, key);
    assert.deepEqual(shared.medications, ["New Medicine"]);
    assert.deepEqual(shared.medicalCondition, details.medicalCondition);
    assert.equal(typeof shared.age, "number");
    assert.equal(shared.dob, undefined);
    assert.equal(shared.allergies, undefined);
    assert.equal(shared.emergencyContact, undefined);
    assert.doesNotMatch(JSON.stringify(record), /New Medicine|Private Allergy|Contact Person|919876543210|1995-05-20/);

    const cleared = await request(base, "PATCH", { revision: 2, bloodType: null, medications: [],
      emergencyContact: [], sharingConsent: { medicalCondition: false, age: false } }, token);
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.profile.bloodType, undefined);
    assert.deepEqual(cleared.body.profile.medications, []);
    assert.deepEqual(cleared.body.profile.emergencyContact, []);
    assert.equal(cleared.body.profile.sharingConsent.medications, true);
    const updatedRecord = await eprofileModel.collection.findOne({ userId: user._id });
    assert.deepEqual(readPublicSnapshot(updatedRecord, key), { displayName: basic.displayName, medications: [] });
    const events = await auditEventModel.find({ actorUserId: user._id, action: "profile.updated" }).lean();
    assert.equal(events.length, 2);
    assert.doesNotMatch(JSON.stringify(events), /Medicine|Allergy|Contact Person|1995-05-20/);
    assert.equal((await request(base, "GET", undefined, token)).body.profile.revision, 3);
  });

  await t.test("missing profiles return 404; body/query/path IDs cannot select another owner's profile", async t => {
    const base = await serve(t); const a = await login(base); const b = await login(base);
    const bCreated = await request(base, "POST", { ...basic, displayName: "Other Owner" }, b.token);
    for (const method of ["GET", "PATCH"]) {
      const result = await request(base, method, method === "PATCH" ? { revision: 1, displayName: "Hijacked" } : undefined,
        a.token, { path: `/user/profile?userId=${b.user._id}` });
      assert.equal(result.response.status, 404);
      assert.doesNotMatch(JSON.stringify(result.body), /Other Owner|1995/);
    }
    assert.equal((await request(base, "POST", { ...basic, userId: b.user._id }, a.token)).response.status, 400);
    assert.equal((await request(base, "PATCH", { revision: 1, displayName: "Hijacked", userId: b.user._id }, a.token)).response.status, 400);
    assert.equal((await request(base, "GET", undefined, a.token, { path: `/user/profile/${bCreated.body.profile.id}` })).response.status, 404);
    assert.equal((await request(base, "POST", basic, a.token)).response.status, 201);
    const own = await request(base, "GET", undefined, a.token, { path: `/user/profile?userId=${b.user._id}` });
    assert.equal(own.body.profile.displayName, basic.displayName);
    assert.equal((await request(base, "GET", undefined, b.token)).body.profile.displayName, "Other Owner");
  });

  await t.test("invalid input and unsupported requests return safe statuses without changing stored data", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    for (const body of [{}, { ...basic, dob: "2023-02-29" }, { ...basic, displayName: " " },
      { ...basic, sharingConsent: { age: "true" } }, { ...basic, revision: 1 },
      { ...basic, emergencyContact: [{ name: "Contact", phone: "wrong" }] }]) {
      const result = await request(base, "POST", body, token);
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, { error: "Invalid profile data" });
    }
    assert.equal(await eprofileModel.countDocuments({ userId: user._id }), 0);
    const created = await request(base, "POST", basic, token);
    const before = await eprofileModel.collection.findOne({ userId: user._id });
    for (const body of [{ revision: 1 }, { revision: 1, sharingConsent: {} },
      { revision: 1, dob: null }, { revision: 1, medicalCondition: ["x".repeat(501)] },
      { revision: 1, sharingConsent: { dob: true } }]) {
      const result = await request(base, "PATCH", body, token);
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, { error: "Invalid profile update" });
    }
    for (const method of ["POST", "PATCH"]) {
      assert.equal((await request(base, method, basic, token, { headers: { "Content-Type": "text/plain" } })).response.status, 415);
      for (const [raw, status] of [["{", 400], [JSON.stringify({ large: "x".repeat(17000) }), 413]]) {
        assert.equal((await request(base, method, undefined, token, { raw })).response.status, status);
      }
    }
    assert.deepEqual(await eprofileModel.collection.findOne({ userId: user._id }), before);
    assert.deepEqual((await request(base, "GET", undefined, token)).body, created.body);
  });

  await t.test("simultaneous creation produces exactly one encrypted profile", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    const results = await Promise.all([request(base, "POST", basic, token), request(base, "POST", basic, token)]);
    assert.deepEqual(results.map(result => result.response.status).sort(), [201, 409]);
    assert.equal(await eprofileModel.countDocuments({ userId: user._id }), 1);
  });

  await t.test("stale and simultaneous edits return 409 without mixing snapshots or losing changes", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    await request(base, "POST", basic, token);
    // Hold the first write until both requests have read revision 1.
    const original = eprofileModel.findOneAndUpdate;
    let release; let arrivals = 0;
    const bothReady = new Promise(resolve => { release = resolve; });
    t.mock.method(eprofileModel, "findOneAndUpdate", function (...args) {
      const query = original.apply(this, args);
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (++arrivals === 2) release();
        await bothReady;
        return execute();
      };
      return query;
    });
    const results = await Promise.all(["First", "Second"].map(displayName => request(base, "PATCH",
      { revision: 1, displayName, sharingConsent: { displayName: true } }, token)));
    assert.equal(arrivals, 2);
    assert.deepEqual(results.map(result => result.response.status).sort(), [200, 409]);
    const winner = results.find(result => result.response.status === 200).body;
    assert.deepEqual((await request(base, "GET", undefined, token)).body, winner);
    assert.equal((await request(base, "PATCH", { revision: 1, medications: ["Stale Medicine"] }, token)).response.status, 409);
    const record = await eprofileModel.collection.findOne({ userId: user._id });
    assert.equal(record.revision, 2);
    assert.deepEqual(readPublicSnapshot(record, key), { displayName: winner.profile.displayName });
  });

  await t.test("logout makes profile access fail on every session", async t => {
    const base = await serve(t); const { token, user } = await login(base);
    await request(base, "POST", basic, token);
    const second = await request(base, "POST", { email: user.email, password }, undefined, { path: "/user/login" });
    assert.equal((await request(base, "POST", undefined, token, { path: "/user/logout" })).response.status, 204);
    for (const bearer of [token, second.body.token]) {
      assert.equal((await request(base, "GET", undefined, bearer)).response.status, 401);
      assert.equal((await request(base, "PATCH", { revision: 1, medications: [] }, bearer)).response.status, 401);
    }
  });

  await t.test("wrong encryption key and altered ciphertext return generic 500 without writes or leaks", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    await request(base, "POST", { ...basic, medications: ["Sensitive Medicine"] }, token);
    const before = await eprofileModel.collection.findOne({ userId: user._id });
    const wrongKeyBase = await serve(t, randomBytes(32).toString("hex"));
    const logs = t.mock.method(console, "error", () => {});
    for (const method of ["GET", "PATCH"]) {
      const result = await request(wrongKeyBase, method, method === "PATCH" ? { revision: 1, medications: [] } : undefined, token);
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, { error: "Internal server error" });
    }
    assert.deepEqual(await eprofileModel.collection.findOne({ userId: user._id }), before);
    const tag = Buffer.from(before.privatePayload.tag, "base64"); tag[0] ^= 1;
    await eprofileModel.collection.updateOne({ _id: before._id }, { $set: { "privatePayload.tag": tag.toString("base64") } });
    for (const method of ["GET", "PATCH"]) {
      const result = await request(base, method, method === "PATCH" ? { revision: 1, displayName: "Changed" } : undefined, token);
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, { error: "Internal server error" });
    }
    assert.equal((await eprofileModel.collection.findOne({ userId: user._id })).revision, 1);
    assert.doesNotMatch(JSON.stringify(logs.mock.calls.map(call => call.arguments)), /1995|Medicine|Profile Owner|ciphertext/);
  });

  await t.test("missing encryption key fails before creating a profile", async t => {
    const base = await serve(t, undefined);
    // Explicit null avoids the test helper's default key.
    const invalidBase = await serve(t, null); const { user, token } = await login(base);
    const result = await request(invalidBase, "POST", basic, token);
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "Internal server error" });
    assert.equal(await eprofileModel.countDocuments({ userId: user._id }), 0);
  });

  for (const [name, method, operation] of [["create", "POST", "create"], ["read", "GET", "findOne"],
    ["update", "PATCH", "findOneAndUpdate"]]) {
    await t.test(`${name} database failures return 503 without exposing details or making partial changes`, async t => {
      const base = await serve(t); const { user, token } = await login(base);
      if (method !== "POST") await request(base, "POST", basic, token);
      const before = await eprofileModel.collection.findOne({ userId: user._id });
      t.mock.method(eprofileModel, operation, () => {
        const error = new Error("private database connection and medical details"); error.name = "MongoNetworkError"; throw error;
      });
      const result = await request(base, method, method === "POST" ? basic : method === "PATCH" ? { revision: 1, medications: [] } : undefined, token);
      assert.equal(result.response.status, 503);
      assert.equal(result.response.headers.get("retry-after"), "5");
      assert.doesNotMatch(JSON.stringify(result.body), /private|medical|connection/);
      assert.deepEqual(await eprofileModel.collection.findOne({ userId: user._id }), before);
    });
  }

  await t.test("unexpected write failure returns safe 500 without creating a profile", async t => {
    const base = await serve(t); const { user, token } = await login(base);
    t.mock.method(eprofileModel, "create", () => { throw new Error("private write details"); });
    const result = await request(base, "POST", basic, token);
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "Internal server error" });
    assert.equal(await eprofileModel.collection.countDocuments({ userId: user._id }), 0);
  });

  await t.test("audit failure does not undo saved edits and warnings contain no health data", async t => {
    const base = await serve(t); const { token } = await login(base);
    const warnings = t.mock.method(console, "warn", () => {});
    t.mock.method(auditEventModel, "create", () => { throw new Error("Sensitive Medicine 1995-05-20"); });
    assert.equal((await request(base, "POST", basic, token)).response.status, 201);
    const edited = await request(base, "PATCH", { revision: 1, medications: ["Sensitive Medicine"] }, token);
    assert.equal(edited.response.status, 200);
    assert.deepEqual((await request(base, "GET", undefined, token)).body, edited.body);
    assert.equal(warnings.mock.callCount(), 2);
    assert.doesNotMatch(JSON.stringify(warnings.mock.calls.map(call => call.arguments)), /Medicine|1995|Profile Owner/);
  });
});
