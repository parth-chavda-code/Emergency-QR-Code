import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import express from "express";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { authSessionModel } from "../backend/models/auth_session.js";
import { auditEventModel } from "../backend/models/audit_event.js";
import { authUser } from "../backend/middlewares/authMiddleware.js";
import { errorHandler } from "../backend/middlewares/errors.js";
import { logoutEverywhere } from "../backend/security/authSessions.js";

const secret = randomBytes(32).toString("hex");
const password = "a unique logout test passphrase";

async function serve(t, protectedOnly = false) {
  const app = protectedOnly ? express() : createApp({ jwtSecret: secret });
  if (protectedOnly) {
    app.locals.jwtSecret = secret;
    app.use(express.json());
    // Test fixture only, not an endpoint in the real application.
    app.get("/test-private", authUser, (req, res) => res.json({ userId: req.userId }));
    app.use(errorHandler);
  }
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, path, { method = "POST", token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

async function login(base, email) {
  const result = await request(base, "/user/login", { body: { email, password } });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

function signedToken(userId, sessionId) {
  return jwt.sign({ sid: sessionId.toString() }, secret, {
    subject: userId.toString(), algorithm: "HS256", issuer: "emergency-qr-code",
    audience: "emergency-qr-api", expiresIn: "15m",
  });
}

test("logout requires header authentication and never accepts a body token", async t => {
  const base = await serve(t);
  for (const body of [undefined, { token: "untrusted", userId: "another-user" }]) {
    const result = await request(base, "/user/logout", { body });
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("www-authenticate"), "Bearer");
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  }
});

test("session lifecycle and global logout with real MongoDB", {
  skip: !process.env.TEST_MONGODB_URI, timeout: 60000,
}, async t => {
  await connectDB(process.env.TEST_MONGODB_URI);
  t.after(disconnectDB);
  const hash = await bcrypt.hash(password, 10);
  const account = async () => userModel.create({ email: `logout-${randomUUID()}@example.com`,
    firstName: "Logout", lastName: "Test", password: hash });

  await t.test("two devices lose access, another account stays logged in, fresh login works", async t => {
    const base = await serve(t); const privateBase = await serve(t, true);
    const owner = await account(); const other = await account();
    const first = await login(base, owner.email); const second = await login(base, owner.email);
    const unrelated = await login(base, other.email);
    for (const token of [first, second, unrelated]) {
      assert.equal((await request(privateBase, "/test-private", { method: "GET", token })).response.status, 200);
    }
    // Body IDs are ignored: they cannot redirect logout to another account.
    const logout = await request(base, "/user/logout", { token: first, body: { userId: other._id } });
    assert.equal(logout.response.status, 204);
    assert.equal(logout.body, undefined);
    assert.equal(logout.response.headers.get("cache-control"), "no-store");
    for (const token of [first, second]) {
      assert.equal((await request(privateBase, "/test-private", { method: "GET", token })).response.status, 401);
      assert.equal((await request(base, "/user/logout", { token })).response.status, 401);
    }
    assert.equal((await request(privateBase, "/test-private", { method: "GET", token: unrelated })).response.status, 200);
    const fresh = await login(base, owner.email);
    assert.equal((await request(privateBase, "/test-private", { method: "GET", token: fresh })).response.status, 200);
    const user = await userModel.findById(owner._id).select("+loginVersion");
    assert.equal(user.loginVersion, 1);
    assert.equal(user.toJSON().loginVersion, undefined);
    const sessions = await authSessionModel.find({ userId: owner._id }).lean();
    assert.equal(sessions.filter(session => session.revokedAt instanceof Date).length, 2);
    const events = await auditEventModel.find({ actorUserId: owner._id }).lean();
    assert.equal(events.filter(event => event.action === "auth.login").length, 3);
    assert.equal(events.filter(event => event.action === "auth.logout").length, 1);
    const text = JSON.stringify(events);
    for (const secretValue of [password, hash, first, second, owner.email]) assert.equal(text.includes(secretValue), false);
    assert.equal(logout.response.headers.get("set-cookie"), null);
  });

  await t.test("missing, expired, revoked, mismatched, versionless and deleted-account sessions fail", async t => {
    const base = await serve(t); const privateBase = await serve(t, true);
    const owner = await account(); const other = await account();
    const expiresAt = new Date(Date.now() + 900000);
    const sessions = [
      { userId: owner._id, expiresAt: new Date(Date.now() - 1000) },
      { userId: owner._id, expiresAt, revokedAt: new Date() },
      { userId: other._id, expiresAt },
      { userId: owner._id, expiresAt, loginVersion: 7 },
      { userId: new mongoose.Types.ObjectId(), expiresAt },
    ];
    for (const input of sessions) {
      const session = await authSessionModel.create(input);
      const token = signedToken(input.userId.equals(other._id) ? owner._id : input.userId, session._id);
      const result = await request(privateBase, "/test-private", { method: "GET", token });
      assert.equal(result.response.status, 401);
      assert.deepEqual(result.body, { error: "Invalid or expired authentication token" });
    }
    const absent = signedToken(owner._id, new mongoose.Types.ObjectId());
    assert.equal((await request(base, "/user/logout", { token: absent })).response.status, 401);
    const oldJwt = jwt.sign({}, secret, { subject: owner._id.toString(), issuer: "emergency-qr-code",
      audience: "emergency-qr-api", expiresIn: "15m" });
    assert.equal((await request(base, "/user/logout", { token: oldJwt })).response.status, 401);
    const current = await login(base, owner.email);
    await userModel.deleteOne({ _id: owner._id });
    assert.equal((await request(base, "/user/logout", { token: current })).response.status, 401);
  });

  await t.test("missing account login version fails safely and is not initialized by logout", async t => {
    const base = await serve(t);
    const owner = await account();
    const token = await login(base, owner.email);
    await userModel.collection.updateOne({ _id: owner._id }, { $unset: { loginVersion: "" } });
    const result = await request(base, "/user/logout", { token });
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "Internal server error" });
    assert.equal(await logoutEverywhere(owner._id, 0), false);
    assert.equal((await userModel.collection.findOne({ _id: owner._id })).loginVersion, undefined);
    const loginResult = await request(base, "/user/login", { body: { email: owner.email, password } });
    assert.equal(loginResult.response.status, 500);
    assert.equal(loginResult.body.token, undefined);
  });

  await t.test("missing session login version fails safely instead of becoming zero", async t => {
    const base = await serve(t);
    const owner = await account();
    const token = await login(base, owner.email);
    const { sid } = jwt.decode(token);
    await authSessionModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(sid) },
      { $unset: { loginVersion: "" } });
    const result = await request(base, "/user/logout", { token });
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "Internal server error" });
    assert.equal((await userModel.findById(owner._id).select("+loginVersion")).loginVersion, 0);
  });

  await t.test("logout rejects a missing version before changing the account", async () => {
    const owner = await account();
    for (const version of [undefined, null]) {
      await assert.rejects(logoutEverywhere(owner._id, version), /Invalid account login version/);
    }
    assert.equal((await userModel.findById(owner._id).select("+loginVersion")).loginVersion, 0);
  });

  await t.test("login overlapping logout cannot issue a usable session from the old version", async t => {
    const base = await serve(t);
    const owner = await account();
    const original = authSessionModel.create;
    t.mock.method(authSessionModel, "create", async function (value) {
      assert.equal(await logoutEverywhere(owner._id, 0), true);
      return original.call(this, value);
    });
    const result = await request(base, "/user/login", { body: { email: owner.email, password } });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.token, undefined);
    const session = await authSessionModel.findOne({ userId: owner._id });
    const staleToken = signedToken(owner._id, session._id);
    assert.equal((await request(base, "/user/logout", { token: staleToken })).response.status, 401);
  });

  await t.test("overlapping logouts cannot invalidate a later fresh login", async t => {
    const base = await serve(t); const privateBase = await serve(t, true);
    const owner = await account();
    await login(base, owner.email);
    const results = await Promise.all([logoutEverywhere(owner._id, 0), logoutEverywhere(owner._id, 0)]);
    assert.deepEqual(results.sort(), [false, true]);
    const fresh = await login(base, owner.email);
    assert.equal(await logoutEverywhere(owner._id, 0), false);
    assert.equal((await request(privateBase, "/test-private", { method: "GET", token: fresh })).response.status, 200);
  });

  await t.test("session creation failure returns 503 without a token", async t => {
    const base = await serve(t); const owner = await account();
    t.mock.method(authSessionModel, "create", async () => {
      const error = new Error("private database details"); error.name = "MongoNetworkError"; throw error;
    });
    const result = await request(base, "/user/login", { body: { email: owner.email, password } });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.token, undefined);
    assert.equal(await authSessionModel.countDocuments({ userId: owner._id }), 0);
  });

  await t.test("session lookup database failure returns 503 and unexpected failure returns 500", async t => {
    const base = await serve(t); const owner = await account();
    const token = await login(base, owner.email);
    const lookup = t.mock.method(authSessionModel, "findOne", () => {
      const error = new Error("private lookup details"); error.name = "MongoNetworkError"; throw error;
    });
    const unavailable = await request(base, "/user/logout", { token });
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.response.headers.get("retry-after"), "5");
    assert.doesNotMatch(JSON.stringify(unavailable.body), /private/);
    lookup.mock.restore();
    t.mock.method(authSessionModel, "findOne", () => { throw new Error("private unexpected detail"); });
    const failed = await request(base, "/user/logout", { token });
    assert.equal(failed.response.status, 500);
    assert.deepEqual(failed.body, { error: "Internal server error" });
  });

  await t.test("logout database-write failure reports 503 and does not claim success", async t => {
    const base = await serve(t); const owner = await account();
    const token = await login(base, owner.email);
    t.mock.method(userModel, "updateOne", async () => {
      const error = new Error("private write failure"); error.name = "MongoNetworkError"; throw error;
    });
    const result = await request(base, "/user/logout", { token });
    assert.equal(result.response.status, 503);
    assert.equal((await userModel.findById(owner._id).select("+loginVersion")).loginVersion, 0);
  });

  await t.test("bookkeeping and audit failures never reverse a successful logout", async t => {
    const base = await serve(t); const owner = await account();
    const token = await login(base, owner.email);
    const warnings = t.mock.method(console, "warn", () => {});
    t.mock.method(authSessionModel, "updateMany", async () => { throw new Error("private bookkeeping details"); });
    t.mock.method(auditEventModel, "create", async () => { throw new Error("private audit details"); });
    const result = await request(base, "/user/logout", { token });
    assert.equal(result.response.status, 204);
    assert.equal((await request(base, "/user/logout", { token })).response.status, 401);
    const fresh = await login(base, owner.email);
    assert.ok(fresh);
    assert.ok(warnings.mock.callCount() >= 3);
    assert.doesNotMatch(JSON.stringify(warnings.mock.calls.map(call => call.arguments)), /private|mongodb|password/);
  });
});
