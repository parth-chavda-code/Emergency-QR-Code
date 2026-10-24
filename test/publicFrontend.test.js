import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createApp } from "../backend/app.js";
import { assertFrontendBuild } from "../backend/publicFrontend.js";
import { validateConfig } from "../backend/config.js";

test("public QR browser navigation serves a private-data-free shell; JSON retains existing unavailable behavior", async t => {
  const server = http.createServer(createApp());
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/e/not-a-token`, { headers: { Accept: "text/html" } });
  const built = existsSync(new URL("../frontend/dist/index.html", import.meta.url));
  assert.equal(response.status, built ? 200 : 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.match(response.headers.get("vary"), /Accept/);
  const html = await response.text();
  assert.doesNotMatch(html, /not-a-token|publicProfile|privatePayload/);
  if (built) {
    assert.match(response.headers.get("content-type"), /text\/html/);
    const source = /src="(\/assets\/[^"<>]+\.js)"/.exec(html)?.[1];
    assert.ok(source);
    assert.equal((await fetch(base + source)).status, 200);
    assert.equal((await fetch(base + "/fonts/space-grotesk-latin.woff2")).status, 200);
  }
  const json = await fetch(`${base}/e/not-a-token`, { headers: { Accept: "application/json" } });
  assert.equal(json.status, 404);
  assert.deepEqual(await json.json(), { error: "Emergency profile unavailable" });
  assert.equal((await fetch(`${base}/e/not-a-token`)).status, 404);
});

test("owner browser entry serves React; APIs, secrets, missing assets and unknown paths never return the shell", async t => {
  const server = http.createServer(createApp());
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const built = existsSync(new URL("../frontend/dist/index.html", import.meta.url));
  if (built) assert.doesNotThrow(assertFrontendBuild);
  else assert.throws(assertFrontendBuild);
  for (const method of ["GET", "HEAD"]) {
    const response = await fetch(base + "/", { method, headers: { Accept: "text/html" } });
    assert.equal(response.status, built ? 200 : 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    if (built && method === "GET") assert.match(await response.text(), /id="root"/);
  }
  for (const path of ["/.env", "/backend/config.js", "/unknown", "/health", "/assets/missing.js",
    "/fonts/missing.woff2", "/api/user/login", "/user/unknown"]) {
    const response = await fetch(base + path, { headers: { Accept: "text/html" } });
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Route not found" });
  }
  const login = await fetch(base + "/user/login", { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/html" }, body: "{}" });
  assert.equal(login.status, 400);
  assert.deepEqual(await login.json(), { error: "Invalid login data" });
  assert.equal((await fetch(base + "/user/profile")).status, 401);
  assert.equal((await fetch(base + "/user/qr-credentials")).status, 401);
});

test("one trusted proxy keeps rate limits per rightmost client address and ignores prepended spoofed values", async t => {
  const app = createApp({ trustProxyHops: 1 });
  assert.equal(app.get("trust proxy"), 1);
  assert.equal(createApp().get("trust proxy"), 0);
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const attempt = forwarded => fetch(base + "/user/login", { method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded }, body: "{}" });
  for (let i = 0; i < 10; i++) {
    assert.equal((await attempt(`198.51.100.${i + 1}, 203.0.113.1`)).status, 400);
  }
  assert.equal((await attempt("198.51.100.99, 203.0.113.1")).status, 429);
  assert.equal((await attempt("203.0.113.2")).status, 400);
});

for (const [family, visitor, otherVisitor] of [
  ["IPv4", "203.0.113.10", "203.0.113.11"],
  ["IPv6", "2001:db8:1234::1", "2001:db8:5678::1"],
]) {
  test(`observed three-hop Render path limits the original ${family} visitor despite changing proxies and fake headers`, async t => {
    const config = validateConfig({ dbconnection: "mongodb://127.0.0.1:1/disposable",
      JWT_SECRET: "synthetic-proxy-test-secret-at-least-32-bytes",
      PROFILE_ENCRYPTION_KEY: "ab".repeat(32), TRUST_PROXY_HOPS: "3" });
    const app = createApp(config);
    assert.equal(app.get("trust proxy"), 3);
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const attempt = (client, i, spoof = false) => fetch(base + "/user/login", { method: "POST",
      headers: { "Content-Type": "application/json",
        "X-Forwarded-For": `${spoof ? `198.51.100.${i + 1}, ` : ""}${client}, 172.71.${i % 2 ? "202.82" : "124.85"}, ${i % 2 ? "10.27.188.5" : "10.29.8.12"}`,
        "CF-Connecting-IP": `198.51.100.${i + 1}`, "X-Real-IP": `198.51.100.${i + 1}` }, body: "{}" });
    let policy;
    for (let i = 0; i < 10; i++) {
      const response = await attempt(visitor, i, i % 2 === 1);
      assert.equal(response.status, 400);
      const partition = /pk=:([^:]+):/.exec(response.headers.get("ratelimit-policy"))?.[1];
      assert.ok(partition);
      if (i === 0) policy = partition;
      else assert.equal(partition, policy, "changing proxies and spoofed headers must not change the visitor counter");
      assert.match(response.headers.get("ratelimit"), new RegExp(`r=${9 - i};`));
    }
    const blocked = await attempt(visitor, 10, true);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.deepEqual(await blocked.json(), { error: "Too many login attempts. Please try again later." });
    assert.equal((await attempt(visitor, 11)).status, 429);
    assert.equal((await attempt(otherVisitor, 12, true)).status, 400, "a different visitor keeps a separate allowance");
  });
}
