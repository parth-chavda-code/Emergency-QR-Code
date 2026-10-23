import test from "node:test";
import assert from "node:assert/strict";
import { activateQr, getPublicPreview, getQrStatus, issueQr, readIssuedQr, readPublicPreview, revokeQr } from "../src/qrApi.js";

const id = "507f1f77bcf86cd799439011";
const secondId = "507f1f77bcf86cd799439012";
const credential = (state = "pending", recordId = id) => ({ id: recordId, state, replacesCredentialId: null });
const preview = publicProfile => ({ publicProfile, profileRevision: 2, hasSharedInformation: true });
const token = "a".repeat(43);

test("public preview accepts age zero and optional categories while rejecting private or malformed data", () => {
  assert.deepEqual(readPublicPreview(preview({ age: 0 })).publicProfile, { age: 0 });
  assert.deepEqual(readPublicPreview({ publicProfile: { allergies: [] }, profileRevision: 1, hasSharedInformation: false }).publicProfile, { allergies: [] });
  for (const publicProfile of [{ dob: "2000-01-01" }, { email: "private@example.com" }, { age: -1 }, { age: 2.5 },
    { bloodType: "Unknown" }, { allergies: [" "] }, { medicalCondition: "text" }, { displayName: " " },
    { emergencyContact: [{ name: "Contact", phone: "123" }] }]) assert.throws(() => readPublicPreview(preview(publicProfile)));
  assert.throws(() => readPublicPreview(preview({})));
  const contacts = readPublicPreview(preview({ emergencyContact: [{ name: "Demo", phone: "+12025550123", privateNote: "excluded" }] }));
  assert.deepEqual(contacts.publicProfile.emergencyContact, [{ name: "Demo", phone: "+12025550123" }]);
});

test("issued QR validates its public URL and does not retain a separate token", () => {
  const data = { credential: credential(), token, qrUrl: `https://example.com/e/${token}` };
  assert.deepEqual(readIssuedQr(data), { credential: credential(), qrUrl: data.qrUrl });
  for (const qrUrl of [`javascript:alert(1)`, `https://user:pass@example.com/e/${token}`, `https://example.com/e/other`,
    `https://example.com/e/${token}?leak=yes`, `https://example.com/e/${token}#fragment`]) assert.throws(() => readIssuedQr({ ...data, qrUrl }));
  assert.throws(() => readIssuedQr({ ...data, credential: credential("active") }));
});

test("QR status reads all history pages so an older active QR is not missed", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { credentials: [credential("revoked")], nextCursor: id }
      : { credentials: [credential("active", secondId)], nextCursor: null });
  });
  assert.deepEqual(await getQrStatus("synthetic-session"), { active: credential("active", secondId), pending: null });
  assert.equal(calls[1].url, `/user/qr-credentials?limit=50&cursor=${id}`);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, "Bearer synthetic-session");
    assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
  }
});

test("QR status fails safely on duplicate records, invalid cursors and multiple active records", async t => {
  for (const data of [{ credentials: [credential(), credential()], nextCursor: null },
    { credentials: [], nextCursor: "untrusted?cursor=yes" },
    { credentials: [credential("active"), credential("active", secondId)], nextCursor: null }]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(data));
    await assert.rejects(getQrStatus("session"), /couldn't read|needs checking/);
    mock.mock.restore();
  }
});

test("QR mutation bodies contain only revision or an empty object; responses must match requested action", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("activate")) return Response.json({ credential: credential("active") });
    if (url.endsWith("revoke")) return Response.json({ credential: credential("revoked") });
    return Response.json({ credential: credential(), token, qrUrl: `https://example.com/e/${token}` }, { status: 201 });
  });
  await issueQr("session", 2); await activateQr("session", id); await revokeQr("session", id);
  assert.deepEqual(calls.map(call => JSON.parse(call.options.body)), [{ profileRevision: 2 }, {}, {}]);
  assert.ok(calls.every(call => call.options.method === "POST"));
  await assert.rejects(issueQr("session", 0), /Refresh/);
  await assert.rejects(activateQr("session", "invalid/id"), /Refresh/);
});

test("QR errors preserve status and never expose raw server errors or imply successful mutations", async t => {
  for (const status of [401, 404, 409, 429, 500, 503]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("private database stack", { status }));
    await assert.rejects(issueQr("session", 2), error => error.status === status && !/database stack/.test(error.message));
    mock.mock.restore();
  }
  let mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("private network error"); });
  await assert.rejects(issueQr("session", 2), /couldn't confirm.*Refresh/);
  mock.mock.restore();
  mock = t.mock.method(globalThis, "fetch", async () => Response.json({ credential: credential("pending") }));
  await assert.rejects(activateQr("session", id), /couldn't confirm/);
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json(preview({ dob: "2000-01-01" })));
  await assert.rejects(getPublicPreview("session"), /couldn't read/);
});

test("public preview accepts multiline additional information as plain text and rejects malformed values", () => {
  const value = "Example\n<script>alert('plain text')</script>";
  assert.equal(readPublicPreview(preview({ additionalInformation: value })).publicProfile.additionalInformation, value);
  for (const additionalInformation of ["", "  ", null, {}, "x".repeat(1001), "bad\u0000text"]) {
    assert.throws(() => readPublicPreview(preview({ additionalInformation })));
  }
});
