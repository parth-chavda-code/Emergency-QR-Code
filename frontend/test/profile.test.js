import test from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, ownerAge, profileChanges, profilePayload, profileToForm, readProfileResponse, validateProfile } from "../src/profileForm.js";
import { ApiError, createProfile, getProfile, logoutEverywhere, updateProfile } from "../src/api.js";

const form = () => ({ ...emptyProfile(), displayName: "Profile Review", dob: "1995-05-20" });
const saved = () => ({ ...profilePayload(form()), id: "507f1f77bcf86cd799439011", revision: 1 });

test("new profiles are empty and private; required-only profiles are valid", () => {
  const empty = emptyProfile();
  assert.equal(Object.values(empty.sharingConsent).every(value => value === false), true);
  assert.deepEqual(empty.emergencyContact, []);
  assert.deepEqual(Object.keys(validateProfile(empty)).sort(), ["displayName", "dob"]);
  assert.deepEqual(validateProfile(form()), {});
  empty.sharingConsent.age = true;
  assert.equal(emptyProfile().sharingConsent.age, false);
});

test("dates and owner age follow UTC birthdays including leap years and newborns", () => {
  const today = new Date("2026-10-22T00:00:00Z");
  assert.equal(ownerAge("2000-10-22", today), 26);
  assert.equal(ownerAge("2000-10-23", today), 25);
  assert.equal(ownerAge("2026-10-22", today), 0);
  assert.equal(ownerAge("2026-10-23", today), null);
  assert.equal(ownerAge("2000-02-29", new Date("2025-02-28T23:59:59Z")), 24);
  assert.equal(ownerAge("2000-02-29", new Date("2025-03-01T00:00:00Z")), 25);
  for (const dob of ["", "0000-01-01", "2025-02-29", "2026-02-30", "1990-01-01T00:00:00Z"]) {
    assert.ok(validateProfile({ ...form(), dob }, today).dob);
  }
});

test("profile validation enforces names, medical limits, contact limits and total UTF-8 size", () => {
  assert.deepEqual(validateProfile({ ...form(), displayName: "😀".repeat(100), allergies: ["a".repeat(500)] }), {});
  for (const displayName of [" ", "x".repeat(101), "Name\nOther"]) assert.ok(validateProfile({ ...form(), displayName }).displayName);
  for (const value of [" ", "x".repeat(501), "line\nline"]) assert.ok(validateProfile({ ...form(), medications: [value] })["medications.0"]);
  assert.ok(validateProfile({ ...form(), allergies: Array(31).fill("sample") }).allergies);
  assert.ok(validateProfile({ ...form(), bloodType: "O−" }).bloodType);
  assert.deepEqual(validateProfile({ ...form(), emergencyContact: [{ name: "Contact", phone: "+919876543210", relation: "" }] }), {});
  assert.ok(validateProfile({ ...form(), emergencyContact: [{ name: "", phone: "123", relation: "" }] })["emergencyContact.0.phone"]);
  assert.ok(validateProfile({ ...form(), emergencyContact: [{ name: "", phone: "+12", relation: "" }] })["emergencyContact.0.name"]);
  assert.ok(validateProfile({ ...form(), emergencyContact: Array(6).fill({ name: "Contact", phone: "+12", relation: "" }) }).emergencyContact);
  assert.ok(validateProfile({ ...form(), allergies: Array(30).fill("界".repeat(500)), medications: Array(30).fill("界".repeat(500)) }).body);
});

test("creation payloads exclude metadata and empty optional values without inventing consent", () => {
  const input = { ...form(), displayName: " Profile Review ", userId: "foreign", revision: 99,
    emergencyContact: [{ name: " Contact ", phone: " +12 ", relation: " " }],
    allergies: [" Sample allergy "], sharingConsent: { ...form().sharingConsent, allergies: true, dob: true } };
  const body = profilePayload(input);
  assert.equal(body.displayName, "Profile Review");
  assert.deepEqual(body.allergies, ["Sample allergy"]);
  assert.deepEqual(body.emergencyContact, [{ name: "Contact", phone: "+12" }]);
  for (const key of ["userId", "revision", "bloodType"]) assert.equal(Object.hasOwn(body, key), false);
  assert.equal(Object.hasOwn(body.sharingConsent, "dob"), false);
});

test("updates preserve omission and consent, clear blood type explicitly and carry the saved revision", () => {
  const original = { ...saved(), bloodType: "O+", allergies: ["Sample"], sharingConsent: { ...form().sharingConsent, allergies: true } };
  const draft = profileToForm(original);
  assert.deepEqual(profileChanges(draft, original), { revision: 1 });
  draft.displayName = "Edited name";
  assert.deepEqual(profileChanges(draft, original), { revision: 1, displayName: "Edited name" });
  draft.bloodType = ""; draft.allergies = []; draft.sharingConsent.allergies = false;
  assert.deepEqual(profileChanges(draft, original), { revision: 1, displayName: "Edited name", bloodType: null, allergies: [], sharingConsent: { allergies: false } });
  assert.deepEqual(original.allergies, ["Sample"]);
  assert.equal(original.sharingConsent.allergies, true);
});

test("reading saved profiles validates consent and contents before rendering", () => {
  assert.deepEqual(readProfileResponse({ profile: saved() }), saved());
  for (const profile of [null, { ...saved(), revision: 0 }, { ...saved(), dob: "bad" },
    { ...saved(), sharingConsent: {} }, { ...saved(), medications: null },
    { ...saved(), sharingConsent: { ...form().sharingConsent, age: "false" } }]) {
    assert.throws(() => readProfileResponse({ profile }), /Invalid profile response/);
  }
});

test("profile API uses Bearer authentication, creates/updates explicit data and treats only GET 404 as empty", async t => {
  const calls = [];
  const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ profile: saved() }, { status: options.method === "POST" ? 201 : 200 });
  });
  assert.deepEqual(await getProfile("test-token"), saved());
  await createProfile("test-token", form());
  await updateProfile("test-token", { revision: 1, displayName: "Changed", userId: "foreign", privatePayload: "bad" });
  assert.deepEqual(calls.map(call => call.options.method), ["GET", "POST", "PATCH"]);
  assert.deepEqual(JSON.parse(calls[2].options.body), { revision: 1, displayName: "Changed" });
  for (const { url, options } of calls) {
    assert.equal(url, "/user/profile"); assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
  }
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  assert.equal(await getProfile("test-token"), null);
  await assert.rejects(updateProfile("test-token", { revision: 1, displayName: "Changed" }), error => error.status === 404);
});

test("profile requests distinguish conflicts, invalid sessions and outages without exposing raw responses", async t => {
  for (const status of [400, 401, 409, 413, 429, 500, 503]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("private data and stacktrace", { status }));
    await assert.rejects(updateProfile("test-token", { revision: 1, displayName: "Changed" }), error => {
      assert.ok(error instanceof ApiError); assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /stacktrace|private data/); return true;
    });
    mock.mock.restore();
  }
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("internal network details"); });
  await assert.rejects(createProfile("test-token", form()), /couldn't confirm/);
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ profile: { ...saved(), sharingConsent: {} } }));
  await assert.rejects(getProfile("test-token"), /couldn't read the saved profile/);
});

test("oversized JSON changes fail before transmission using the existing 16 KiB server limit", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not send"); });
  const large = { ...form(), allergies: Array(20).fill("a".repeat(500)), medications: Array(20).fill("m".repeat(500)) };
  assert.deepEqual(validateProfile(large), {});
  await assert.rejects(createProfile("test-token", large), error => error.status === 413);
  assert.equal(fetch.mock.callCount(), 0);
});

test("logout accepts only confirmed 204 and sends no owner or medical fields", async t => {
  let request;
  const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, options }; return new Response(null, { status: 204 });
  });
  assert.equal(await logoutEverywhere("test-token"), undefined);
  assert.equal(request.url, "/user/logout"); assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, undefined); assert.equal(request.options.headers.Authorization, "Bearer test-token");
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(logoutEverywhere("test-token"), /couldn't confirm sign-out/);
});

test("additional information supports legacy responses, editing, clearing and safe limits", async t => {
  const legacy = saved(); delete legacy.additionalInformation; delete legacy.sharingConsent.additionalInformation;
  const restored = readProfileResponse({ profile: legacy });
  assert.equal(restored.additionalInformation, "");
  assert.equal(restored.sharingConsent.additionalInformation, false);
  const draft = profileToForm(restored);
  draft.additionalInformation = "First line\nSecond line";
  draft.sharingConsent.additionalInformation = true;
  assert.deepEqual(profileChanges(draft, restored), { revision: 1, additionalInformation: draft.additionalInformation, sharingConsent: { additionalInformation: true } });
  assert.deepEqual(validateProfile({ ...form(), additionalInformation: "x".repeat(1000) }), {});
  for (const value of ["x".repeat(1001), "bad\u0000text"]) assert.ok(validateProfile({ ...form(), additionalInformation: value }).additionalInformation);
  const edited = { ...restored, ...profilePayload(draft) };
  draft.additionalInformation = "";
  assert.deepEqual(profileChanges(draft, edited), { revision: 1, additionalInformation: "" });
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => { sent = JSON.parse(options.body); return Response.json({ profile: edited }); });
  await updateProfile("test-token", { revision: 1, additionalInformation: "Example" });
  assert.equal(sent.additionalInformation, "Example");
});
