import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { createApp } from "../backend/app.js";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { signupSchema, loginSchema } from "../backend/validation/user.js";

const validBody = {
  email: "person@example.com",
  firstName: "Parth",
  lastName: "Chavda",
  password: "A long example passphrase 🚑",
};

test("signup enforces the new password rules while login keeps accepting existing passwords", () => {
  for (const password of ["Aa!aaaaaaa", "Ää!aaaaaaa", "Aa" + "a".repeat(7) + "🐎"]) {
    assert.equal(signupSchema.safeParse({ ...validBody, password }).success, true);
  }
  for (const password of ["Aa!aaaaaa", "lowercase!password", "UPPERCASE!PASSWORD", "Upperlower123", "Upper lower123"]) {
    assert.equal(signupSchema.safeParse({ ...validBody, password }).success, false);
    assert.equal(loginSchema.safeParse({ email: validBody.email, password }).success, true);
  }
});

async function serve(t) {
  const server = http.createServer(createApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}/user/signup`;
}

async function signup(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const invalidBodies = [
  ["missing email", { ...validBody, email: undefined }],
  ["missing first name", { ...validBody, firstName: undefined }],
  ["missing last name", { ...validBody, lastName: undefined }],
  ["missing password", { ...validBody, password: undefined }],
  ["invalid email", { ...validBody, email: "bad@" }],
  ["email is an object", { ...validBody, email: { $ne: null } }],
  [
    "email local part too long",
    { ...validBody, email: "x".repeat(65) + "@example.com" },
  ],
  ["email too long", { ...validBody, email: "x".repeat(250) + "@example.com" }],
  ["blank first name", { ...validBody, firstName: "   " }],
  ["blank last name", { ...validBody, lastName: "   " }],
  ["first name too long", { ...validBody, firstName: "x".repeat(101) }],
  ["last name too long", { ...validBody, lastName: "x".repeat(101) }],
  ["control character in name", { ...validBody, firstName: "A\nB" }],
  ["name is a number", { ...validBody, firstName: 123 }],
  ["password too short", { ...validBody, password: "Aa!" + "a".repeat(6) }],
  ["password missing uppercase", { ...validBody, password: "lowercase!password" }],
  ["password missing lowercase", { ...validBody, password: "UPPERCASE!PASSWORD" }],
  ["password missing special character", { ...validBody, password: "Upperlower123" }],
  ["password with only a space as special character", { ...validBody, password: "Upper lower123" }],
  ["password over 72 bytes", { ...validBody, password: "Aa!" + "a".repeat(70) }],
  [
    "Unicode password over 72 bytes",
    { ...validBody, password: "Aa!" + "界".repeat(24) },
  ],
  [
    "mixed password over 72 bytes",
    { ...validBody, password: "Aa!" + "a".repeat(66) + "🐎" },
  ],
  ["password is whitespace", { ...validBody, password: " ".repeat(15) }],
  ["password is an array", { ...validBody, password: ["example"] }],
  ["unknown fields", { ...validBody, role: "admin", createdAt: "2000-01-01" }],
  ["array body", [validBody]],
  ["null body", null],
];
for (const [name, body] of invalidBodies) {
  test(`signup rejects ${name} with a safe 400`, async (t) => {
    const url = await serve(t);
    const result = await signup(url, body);
    assert.equal(result.response.status, 400);
    assert.equal(typeof result.body.error, "string");
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /A long example passphrase|stack|MongoServerError/,
    );
  });
}

test("signup requires JSON", async (t) => {
  const url = await serve(t);
  const result = await signup(url, validBody, { "Content-Type": "text/plain" });
  assert.equal(result.response.status, 415);
});

test("valid signup fails quickly with 503 when database is disconnected", async (t) => {
  const url = await serve(t);
  const result = await signup(url, validBody);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.headers.get("retry-after"), "5");
  assert.equal(result.response.headers.get("cache-control"), "no-store");
});

test("signup rate limit cannot be bypassed by a forwarded IP header", async (t) => {
  const url = await serve(t);
  for (let i = 0; i < 20; i++) {
    const result = await signup(
      url,
      {},
      { "X-Forwarded-For": `192.0.2.${i + 1}` },
    );
    assert.equal(result.response.status, 400);
  }
  const result = await signup(url, {}, { "X-Forwarded-For": "192.0.2.100" });
  assert.equal(result.response.status, 429);
  assert.ok(result.response.headers.get("retry-after"));
  assert.equal(result.response.headers.get("x-ratelimit-limit"), null);
});

test("model rejects storing an unhashed password", async () => {
  await assert.rejects(new userModel(validBody).validate(), {
    name: "ValidationError",
  });
});

test(
  "signup integration with real MongoDB",
  {
    skip: !process.env.TEST_MONGODB_URI,
    timeout: 25000,
  },
  async (t) => {
    await connectDB(process.env.TEST_MONGODB_URI);
    t.after(disconnectDB);

    await t.test(
      "automatic unique email index exists before signup",
      async () => {
        const indexes = await userModel.collection.indexes();
        assert.ok(
          indexes.some(
            (index) => index.key.email === 1 && index.unique === true,
          ),
        );
      },
    );

    await t.test(
      "creates normalized user, timestamp, and verifiable salted hash",
      async (t) => {
        const url = await serve(t);
        const email = `signup-${randomUUID()}@example.com`;
        const request = {
          email: `  ${email.toUpperCase()}  `,
          firstName: "  María-José  ",
          lastName: "  O'Connor  ",
          password: "  Correct horse battery staple 🐎 🚑  ",
        };
        const before = Date.now();
        const result = await signup(url, request);
        assert.equal(result.response.status, 201);
        assert.deepEqual(
          Object.keys(result.body.user).sort(),
          ["id", "email", "firstName", "lastName", "createdAt"].sort(),
        );
        assert.equal(result.body.user.email, email);
        assert.equal(result.body.user.firstName, "María-José");
        assert.equal(result.body.user.lastName, "O'Connor");
        assert.ok(Date.parse(result.body.user.createdAt) >= before);
        assert.ok(Date.parse(result.body.user.createdAt) <= Date.now());
        const stored = await userModel.collection.findOne({ email });
        assert.notEqual(stored.password, request.password);
        assert.match(stored.password, /^\$2b\$10\$/);
        assert.equal(bcrypt.getRounds(stored.password), 10);
        assert.equal(
          await bcrypt.compare(request.password, stored.password),
          true,
        );
        assert.equal(
          await bcrypt.compare("a different wrong password", stored.password),
          false,
        );
        assert.equal(
          await bcrypt.compare(request.password.trim(), stored.password),
          false,
        );
        const normalQuery = await userModel.findOne({ email });
        assert.equal(normalQuery.password, undefined);
        const explicitQuery = await userModel
          .findOne({ email })
          .select("+password");
        assert.equal(explicitQuery.toJSON().password, undefined);
        assert.equal(explicitQuery.toObject().password, undefined);
        const second = await signup(url, {
          ...request,
          email: `salt-${randomUUID()}@example.com`,
        });
        assert.equal(second.response.status, 201);
        const secondStored = await userModel.collection.findOne({
          email: second.body.user.email,
        });
        assert.notEqual(secondStored.password, stored.password);
        assert.equal(await userModel.countDocuments({ email }), 1);
        const duplicate = await signup(url, {
          ...request,
          email: email.toUpperCase(),
        });
        assert.equal(duplicate.response.status, 409);
        assert.deepEqual(duplicate.body, {
          error: "Email is already registered",
        });
      },
    );

    await t.test(
      "simultaneous signups create exactly one account",
      async (t) => {
        const url = await serve(t);
        const email = `race-${randomUUID()}@example.com`;
        const results = await Promise.all([
          signup(url, { ...validBody, email }),
          signup(url, { ...validBody, email: email.toUpperCase() }),
          signup(url, { ...validBody, email: ` ${email} ` }),
        ]);
        assert.deepEqual(
          results.map(({ response }) => response.status).sort(),
          [201, 409, 409],
        );
        assert.equal(await userModel.countDocuments({ email }), 1);
      },
    );

    await t.test(
      "an older mixed-case email also prevents a duplicate signup",
      async (t) => {
        const url = await serve(t);
        const email = `legacy-${randomUUID()}@example.com`;
        // Simulate an account stored before lowercase normalization was implemented.
        await userModel.collection.insertOne({ email: email.toUpperCase() });
        const result = await signup(url, { ...validBody, email });
        assert.equal(result.response.status, 409);
        assert.deepEqual(result.body, { error: "Email is already registered" });
      },
    );

    await t.test(
      "password length boundaries are accepted without truncation",
      async (t) => {
        const url = await serve(t);
        for (const password of [
          "Aa!" + "a".repeat(7),
          "Aa!" + "a".repeat(69),
          "Aa!" + "界".repeat(23),
          "Aa!" + "a".repeat(65) + "🐎",
        ]) {
          const result = await signup(url, {
            ...validBody,
            email: `boundary-${randomUUID()}@example.com`,
            firstName: "名".repeat(100),
            lastName: "姓".repeat(100),
            password,
          });
          assert.equal(result.response.status, 201);
          const stored = await userModel.collection.findOne({
            email: result.body.user.email,
          });
          assert.equal(await bcrypt.compare(password, stored.password), true);
        }
      },
    );

    await t.test("unexpected database failure returns safe 500", async (t) => {
      const url = await serve(t);
      t.mock.method(userModel, "create", async () => {
        throw new Error("sensitive database details");
      });
      const result = await signup(url, {
        ...validBody,
        email: `failure-${randomUUID()}@example.com`,
      });
      assert.equal(result.response.status, 500);
      assert.deepEqual(result.body, { error: "Internal server error" });
    });

    await t.test(
      "bcrypt failure returns safe 500 without creating an account",
      async (t) => {
        const url = await serve(t);
        const email = `hash-failure-${randomUUID()}@example.com`;
        t.mock.method(bcrypt, "hash", async () => {
          throw new Error("sensitive hashing details");
        });
        const result = await signup(url, { ...validBody, email });
        assert.equal(result.response.status, 500);
        assert.deepEqual(result.body, { error: "Internal server error" });
        assert.equal(await userModel.countDocuments({ email }), 0);
      },
    );

    await t.test("database network failure returns safe 503", async (t) => {
      const url = await serve(t);
      t.mock.method(userModel, "create", async () => {
        const error = new Error("sensitive database details");
        error.name = "MongoNetworkError";
        throw error;
      });
      const result = await signup(url, {
        ...validBody,
        email: `network-${randomUUID()}@example.com`,
      });
      assert.equal(result.response.status, 503);
      assert.equal(result.response.headers.get("retry-after"), "5");
      assert.doesNotMatch(
        JSON.stringify(result.body),
        /sensitive database details/,
      );
    });
  },
);
