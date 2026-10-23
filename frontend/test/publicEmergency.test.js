import test from "node:test";
import assert from "node:assert/strict";
import { getPublicEmergency, publicTokenFromPath } from "../src/publicEmergencyApi.js";

const token = "a".repeat(43);

test("public routes accept only a single well-formed token without reading query strings", () => {
  assert.equal(publicTokenFromPath(`/e/${token}`), token);
  for (const path of ["/e", "/e/short", `/e/${token}/extra`, `/e/${token}?other=secret`, "/e/%ZZ", "/user/profile"])
    assert.equal(publicTokenFromPath(path), null);
});

test("public fetch sends no login credentials and explicitly requests uncached JSON", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, options }; return Response.json({ publicProfile: { age: 0 } });
  });
  assert.deepEqual(await getPublicEmergency(token), { state: "available", profile: { age: 0 } });
  assert.equal(sent.url, `/e/${token}`);
  assert.deepEqual(sent.options.headers, { Accept: "application/json" });
  assert.equal(sent.options.credentials, "omit");
  assert.equal(sent.options.cache, "no-store");
  assert.equal(sent.options.referrerPolicy, "no-referrer");
  assert.deepEqual(await getPublicEmergency("invalid"), { state: "unavailable" });
});

test("public API rejects private fields, malformed contacts and corrupted JSON without rendering partial data", async t => {
  for (const publicProfile of [{ displayName: "Demo", dob: "1990-01-01" }, { email: "private@example.test" },
    { age: -1 }, { medications: [" "] }, { emergencyContact: [{ name: "Demo", phone: "javascript:bad" }] }]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ publicProfile }));
    assert.deepEqual(await getPublicEmergency(token), { state: "error" }); mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("<html>server details</html>"));
  assert.deepEqual(await getPublicEmergency(token), { state: "error" });
});

test("missing information is unavailable; HTTP and network errors are distinct from unavailable profiles", async t => {
  for (const [status, state] of [[404, "unavailable"], [410, "unavailable"], [401, "error"], [500, "error"], [503, "error"]]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("private error details", { status }));
    assert.deepEqual(await getPublicEmergency(token), { state }); mock.mock.restore();
  }
  for (const publicProfile of [{}, { allergies: [] }]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ publicProfile }));
    assert.deepEqual(await getPublicEmergency(token), { state: "unavailable" }); mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private network details"); });
  assert.deepEqual(await getPublicEmergency(token), { state: "error" });
});

test("rate limiting uses only a valid server Retry-After value", async t => {
  const before = Date.now();
  let mock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": "2" } }));
  const limited = await getPublicEmergency(token);
  assert.equal(limited.state, "limited"); assert.ok(limited.retryAt >= before + 2000 && limited.retryAt <= Date.now() + 2000);
  mock.mock.restore();
  for (const retry of ["nonsense", "-1", "999999999999999999999", ""]) {
    mock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": retry } }));
    assert.deepEqual(await getPublicEmergency(token), { state: "limited", retryAt: 0 }); mock.mock.restore();
  }
});
