import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { authSessionModel } from "../backend/models/auth_session.js";
import { authUser } from "../backend/middlewares/authMiddleware.js";
import { errorHandler } from "../backend/middlewares/errors.js";

const secret = randomBytes(32).toString("hex");
const userId = "507f1f77bcf86cd799439011";
const sessionId = "507f1f77bcf86cd799439022";
const validBody = {
  email: "person@example.com",
  password: "example password with spaces",
};

async function serve(t, app = createApp({ jwtSecret: secret })) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function signedToken(payload = { sub: userId, sid: sessionId }, options = {}) {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer: "emergency-qr-code",
    audience: "emergency-qr-api",
    expiresIn: "15m",
    ...options,
  });
}

function protectedTestApp(jwtSecret = secret) {
  const app = express();
  app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  // This endpoint exists only in tests, never in the actual backend app.
  app.post("/test-protected", authUser, (req, res) =>
    res.json({ userId: req.userId }),
  );
  app.use(errorHandler);
  return app;
}

const invalidBodies = [
  ["missing email", { password: validBody.password }],
  ["missing password", { email: validBody.email }],
  ["invalid email", { ...validBody, email: "bad@" }],
  ["email object", { ...validBody, email: { $ne: null } }],
  ["password number", { ...validBody, password: 123 }],
  ["password object", { ...validBody, password: { $ne: null } }],
  ["empty password", { ...validBody, password: "" }],
  ["password over 72 bytes", { ...validBody, password: "a".repeat(73) }],
  [
    "Unicode password over 72 bytes",
    { ...validBody, password: "🐎".repeat(19) },
  ],
  ["extra fields", { ...validBody, userId, role: "admin" }],
  ["array body", [validBody]],
];
for (const [name, body] of invalidBodies) {
  test(`login rejects ${name} with safe 400`, async (t) => {
    const base = await serve(t);
    const result = await post(base, "/user/login", body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { error: "Invalid login data" });
  });
}

test("login requires JSON and handles malformed or oversized JSON", async (t) => {
  const base = await serve(t);
  const wrongType = await post(base, "/user/login", validBody, {
    "Content-Type": "text/plain",
  });
  assert.equal(wrongType.response.status, 415);
  for (const [body, status] of [
    ["{", 400],
    [JSON.stringify({ x: "a".repeat(17000) }), 413],
  ]) {
    const response = await fetch(base + "/user/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("login allows short and whitespace passwords but fails safely without database", async (t) => {
  const base = await serve(t);
  for (const password of ["a", " ", "a".repeat(72), "🐎".repeat(18)]) {
    const result = await post(base, "/user/login", { ...validBody, password });
    assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get("retry-after"), "5");
  }
});

test("login has its own 10-attempt limit and ignores spoofed forwarded IPs", async (t) => {
  const base = await serve(t);
  for (let i = 0; i < 10; i++) {
    const result = await post(
      base,
      "/user/login",
      {},
      { "X-Forwarded-For": `192.0.2.${i + 1}` },
    );
    assert.equal(result.response.status, 400);
  }
  const limited = await post(base, "/user/login", {});
  assert.equal(limited.response.status, 429);
  assert.ok(limited.response.headers.get("retry-after"));
  const signup = await post(base, "/user/signup", {});
  assert.equal(signup.response.status, 400);
});

test("middleware rejects missing, malformed, expired, and invalid tokens", async (t) => {
  const base = await serve(t, protectedTestApp());
  const noExpiry = jwt.sign({ sub: userId }, secret, {
    algorithm: "HS256",
    issuer: "emergency-qr-code",
    audience: "emergency-qr-api",
  });
  const tokens = [
    undefined,
    "Basic abc",
    "Bearer abc",
    "Bearer " + signedToken({}, { expiresIn: -1 }),
    "Bearer " + jwt.sign({ sub: userId }, "wrong-secret", { expiresIn: "15m" }),
    "Bearer " + signedToken({ sub: userId }, { algorithm: "HS384" }),
    "Bearer " + signedToken({ sub: userId }, { issuer: "another-app" }),
    "Bearer " + signedToken({ sub: userId }, { audience: "another-api" }),
    "Bearer " + signedToken({ sub: userId }, { notBefore: "1h" }),
    "Bearer " + signedToken({ sub: "invalid-id" }),
    "Bearer " + signedToken({ sub: userId }, { expiresIn: "30m" }),
    "Bearer " +
      signedToken({ sub: userId, iat: Math.floor(Date.now() / 1000) + 300 }),
    "Bearer " + noExpiry,
    "Bearer " + signedToken({ sub: userId }), // Old JWTs need a fresh login.
    "Bearer " + signedToken({ sub: userId, sid: "invalid-session-id" }),
  ];
  for (const authorization of tokens) {
    const result = await post(
      base,
      "/test-protected",
      {},
      authorization
        ? { Authorization: authorization }
        : { token: signedToken() },
    );
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("www-authenticate"), "Bearer");
    assert.deepEqual(Object.keys(result.body), ["error"]);
  }
  // Bad requests must not stop the server. Valid JWTs still require the database.
  const valid = await post(
    base,
    "/test-protected",
    { userId: "another-user" },
    { Authorization: "Bearer " + signedToken() },
  );
  assert.equal(valid.response.status, 503);
  assert.equal(valid.response.headers.get("retry-after"), "5");
});

test("middleware catches a changed token and unexpected verifier failures safely", async (t) => {
  const base = await serve(t, protectedTestApp());
  const parts = signedToken().split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ sub: "507f1f77bcf86cd799439012" }),
  ).toString("base64url");
  const changed = await post(
    base,
    "/test-protected",
    {},
    { Authorization: "Bearer " + parts.join(".") },
  );
  assert.equal(changed.response.status, 401);
  t.mock.method(jwt, "verify", () => {
    throw new Error("private verifier detail");
  });
  const failed = await post(
    base,
    "/test-protected",
    {},
    { Authorization: "Bearer " + signedToken() },
  );
  assert.equal(failed.response.status, 500);
  assert.deepEqual(failed.body, { error: "Internal server error" });
});

test("middleware handles missing server configuration as safe 500", async (t) => {
  const base = await serve(t, protectedTestApp(null));
  const result = await post(
    base,
    "/test-protected",
    {},
    { Authorization: "Bearer " + signedToken() },
  );
  assert.equal(result.response.status, 500);
  assert.deepEqual(result.body, { error: "Internal server error" });
});

test(
  "real signup, login, token verification, and login failures",
  {
    skip: !process.env.TEST_MONGODB_URI,
    timeout: 30000,
  },
  async (t) => {
    await connectDB(process.env.TEST_MONGODB_URI);
    t.after(disconnectDB);
    const account = {
      email: `login-${randomUUID()}@example.com`,
      firstName: "Login",
      lastName: "Test",
      password: "  A unique example passphrase 🐎  ",
    };

    await t.test(
      "signup then login returns a verified 15-minute token and public fields",
      async (t) => {
        const base = await serve(t);
        const signup = await post(base, "/user/signup", account);
        assert.equal(signup.response.status, 201);
        const result = await post(base, "/user/login", {
          email: ` ${account.email.toUpperCase()} `,
          password: account.password,
        });
        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers.get("cache-control"), "no-store");
        assert.equal(result.body.tokenType, "Bearer");
        assert.equal(result.body.expiresIn, 900);
        assert.deepEqual(result.body.user, signup.body.user);
        assert.doesNotMatch(
          JSON.stringify(result.body),
          /password|\$2b\$|JWT_SECRET/,
        );
        const payload = jwt.verify(result.body.token, secret, {
          algorithms: ["HS256"],
          issuer: "emergency-qr-code",
          audience: "emergency-qr-api",
        });
        assert.equal(payload.sub, signup.body.user.id);
        assert.equal(payload.exp - payload.iat, 900);
        assert.deepEqual(
          Object.keys(payload).sort(),
          ["sub", "sid", "iat", "exp", "iss", "aud"].sort(),
        );
        const session = await authSessionModel.findById(payload.sid).lean();
        assert.equal(session.userId.toString(), payload.sub);
        assert.equal(session.loginVersion, 0);
        assert.equal(session.expiresAt.getTime(), payload.exp * 1000);
        assert.equal(session.revokedAt, null);
        assert.equal(session.token, undefined);
        assert.equal(session.password, undefined);
        assert.equal(result.body.user.loginVersion, undefined);
        const protectedBase = await serve(t, protectedTestApp());
        const protectedResult = await post(
          protectedBase,
          "/test-protected",
          { userId: "fake-id" },
          { Authorization: "Bearer " + result.body.token },
        );
        assert.equal(protectedResult.response.status, 200);
        assert.equal(protectedResult.body.userId, signup.body.user.id);
      },
    );

    await t.test(
      "wrong password and unknown email return identical 401; passwords are not trimmed",
      async (t) => {
        const base = await serve(t);
        const bodies = [
          { email: account.email, password: "wrong" },
          {
            email: `absent-${randomUUID()}@example.com`,
            password: account.password,
          },
          { email: account.email, password: account.password.trim() },
        ];
        const comparisons = t.mock.method(bcrypt, "compare");
        for (const body of bodies) {
          const result = await post(base, "/user/login", body);
          assert.equal(result.response.status, 401);
          assert.deepEqual(result.body, { error: "Invalid email or password" });
        }
        assert.equal(comparisons.mock.callCount(), 3);
        const valid = await post(base, "/user/login", {
          email: account.email,
          password: account.password,
        });
        assert.equal(valid.response.status, 200);
      },
    );

    await t.test(
      "login accepts an older short password without adding signup strength rules",
      async (t) => {
        const base = await serve(t);
        const email = `short-${randomUUID()}@example.com`;
        await userModel.create({
          email,
          firstName: "Old",
          lastName: "User",
          password: await bcrypt.hash("a", 10),
        });
        const result = await post(base, "/user/login", {
          email,
          password: "a",
        });
        assert.equal(result.response.status, 200);
      },
    );

    await t.test(
      "legacy scrypt hash fails safely without issuing a token",
      async (t) => {
        const base = await serve(t);
        const email = `legacy-scrypt-${randomUUID()}@example.com`;
        await userModel.collection.insertOne({
          email,
          password: "scrypt$legacy-fixture",
        });
        const result = await post(base, "/user/login", {
          email,
          password: account.password,
        });
        assert.equal(result.response.status, 401);
        assert.deepEqual(result.body, { error: "Invalid email or password" });
      },
    );

    await t.test("database query failure returns safe 503", async (t) => {
      const base = await serve(t);
      t.mock.method(userModel, "findOne", () => {
        const err = new Error("private database detail");
        err.name = "MongoNetworkError";
        throw err;
      });
      const result = await post(base, "/user/login", {
        email: account.email,
        password: account.password,
      });
      assert.equal(result.response.status, 503);
      assert.equal(result.response.headers.get("retry-after"), "5");
      assert.doesNotMatch(
        JSON.stringify(result.body),
        /private database detail/,
      );
    });

    await t.test("password comparison failure returns safe 500", async (t) => {
      const base = await serve(t);
      t.mock.method(bcrypt, "compare", async () => {
        throw new Error("private password detail");
      });
      const result = await post(base, "/user/login", {
        email: account.email,
        password: account.password,
      });
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, { error: "Internal server error" });
    });

    await t.test(
      "token signing failure returns safe 500 without token or account details",
      async (t) => {
        const base = await serve(t);
        const user = await userModel.findOne({ email: account.email });
        const countBefore = await authSessionModel.countDocuments({ userId: user._id });
        t.mock.method(jwt, "sign", () => {
          throw new Error("private signing secret");
        });
        const result = await post(base, "/user/login", {
          email: account.email,
          password: account.password,
        });
        assert.equal(result.response.status, 500);
        assert.deepEqual(result.body, { error: "Internal server error" });
        assert.equal(await authSessionModel.countDocuments({ userId: user._id }), countBefore);
      },
    );
  },
);
