import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../backend/app.js";
import { validateConfig } from "../backend/config.js";

const key = "cd".repeat(32);
async function serve(t, config = {}) {
  const server = http.createServer(createApp(config));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, supplied, options = {}) => fetch(base + "/user/login", {
  method: "POST", headers: { "Content-Type": "application/json",
    ...(supplied ? { "X-Proxy-Diagnostic-Key": supplied } : {}), ...options }, body: "{}",
});

test("proxy diagnostics are disabled by default and validate the optional key", async t => {
  const logs = t.mock.method(console, "info", () => {});
  const base = await serve(t);
  assert.equal((await post(base, key)).status, 400);
  assert.equal(logs.mock.callCount(), 0);
  const env = { dbconnection: "mongodb://127.0.0.1:1/test", JWT_SECRET: "synthetic-test-secret-at-least-32-bytes",
    PROFILE_ENCRYPTION_KEY: "ab".repeat(32) };
  assert.equal(validateConfig(env).proxyDiagnosticsKey, undefined);
  assert.equal(validateConfig({ ...env, PROXY_DIAGNOSTICS_KEY: "" }).proxyDiagnosticsKey, undefined);
  assert.equal(validateConfig({ ...env, PROXY_DIAGNOSTICS_KEY: key }).proxyDiagnosticsKey, key);
  assert.throws(() => validateConfig({ ...env, PROXY_DIAGNOSTICS_KEY: env.PROFILE_ENCRYPTION_KEY }), /different/);
  assert.throws(() => validateConfig({ ...env, JWT_SECRET: key, PROXY_DIAGNOSTICS_KEY: key }), /different/);
  for (const PROXY_DIAGNOSTICS_KEY of ["short", "a".repeat(63), "z".repeat(64), 123, null]) {
    assert.throws(() => validateConfig({ ...env, PROXY_DIAGNOSTICS_KEY }), /PROXY_DIAGNOSTICS_KEY/);
  }
});

test("only correctly tagged login requests log addresses; headers, bodies and URLs stay private", async t => {
  const entries = [];
  t.mock.method(console, "info", entry => entries.push(entry));
  const base = await serve(t, { proxyDiagnosticsKey: key, trustProxyHops: 1 });
  await post(base);
  await post(base, "ef".repeat(32));
  await post(base, "wrong-length");
  await fetch(base + "/user/login", { headers: { "X-Proxy-Diagnostic-Key": key } });
  await fetch(base + "/user/profile", { headers: { "X-Proxy-Diagnostic-Key": key } });
  assert.equal(entries.length, 0);
  const response = await fetch(base + "/user/login?secret=private-query", { method: "POST",
    headers: { "Content-Type": "application/json", "X-Proxy-Diagnostic-Key": key,
      Authorization: "Bearer private-token", "X-Forwarded-For": "198.51.100.1, 203.0.113.2",
      "CF-Connecting-IP": "198.51.100.1", "X-Real-IP": "private-untrusted-text" },
    body: JSON.stringify({ email: "private@example.test", password: "private-password", medical: "private-profile" }) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid login data" });
  assert.equal(entries.length, 1);
  const entry = JSON.parse(entries[0]);
  assert.equal(entry.event, "proxy-diagnostic");
  assert.equal(entry.selectedAddress, "203.0.113.2");
  assert.deepEqual(entry.forwardedAddresses, ["198.51.100.1", "203.0.113.2"]);
  assert.equal(entry.cloudflareAddress, "198.51.100.1");
  assert.equal(entry.realAddress, null);
  for (const secret of [key, "private-query", "private-token", "private@example.test", "private-password", "private-profile", "private-untrusted-text"]) {
    assert.equal(entries[0].includes(secret), false);
  }
});

test("diagnostics stop at six records, sanitize addresses, and never bypass the login limiter", async t => {
  const entries = [];
  t.mock.method(console, "info", entry => entries.push(JSON.parse(entry)));
  const base = await serve(t, { proxyDiagnosticsKey: key, trustProxyHops: 1 });
  const forwarded = ["invalid-address", ...Array.from({ length: 9 }, (_, i) => `198.51.100.${i + 1}`)].join(", ");
  for (let i = 0; i < 11; i++) {
    const response = await post(base, key, { "X-Forwarded-For": forwarded });
    assert.equal(response.status, i < 10 ? 400 : 429);
  }
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map(entry => entry.record), [1, 2, 3, 4, 5, 6]);
  assert.equal(entries[0].forwardedAddresses.length, 8);
  assert.equal(entries[0].forwardedAddresses[0], null);
  assert.equal(entries[0].forwardedTruncated, true);
});
