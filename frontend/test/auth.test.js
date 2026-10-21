import test from "node:test";
import assert from "node:assert/strict";
import { validateLogin, validateSignup } from "../src/validation.js";
import { signup, login, ApiError } from "../src/api.js";

const values = { firstName: "Priya", lastName: "Sharma", email: "priya@example.com",
  password: "a long unique passphrase", confirmPassword: "a long unique passphrase" };

test("signup handles Unicode character/byte boundaries and matching passwords", () => {
  assert.deepEqual(validateSignup(values), {});
  for (const password of ["a".repeat(15), "a".repeat(72), "界".repeat(24), "😀".repeat(18)]) {
    assert.deepEqual(validateSignup({ ...values, password, confirmPassword: password }), {});
  }
  for (const password of ["a".repeat(14), "a".repeat(73), "界".repeat(25), "😀".repeat(19), " ".repeat(15)]) {
    assert.ok(validateSignup({ ...values, password, confirmPassword: password }).password);
  }
  assert.ok(validateSignup({ ...values, confirmPassword: "different" }).confirmPassword);
  assert.ok(validateSignup({ ...values, confirmPassword: "" }).confirmPassword);
  assert.deepEqual(validateSignup({ ...values, firstName: "😀".repeat(100) }), {});
  for (const name of [" ", "a".repeat(101), "Name\nOther"]) {
    assert.ok(validateSignup({ ...values, firstName: name }).firstName);
  }
});

test("login accepts short and whitespace passwords but enforces the byte limit", () => {
  for (const password of ["x", " ", "😀".repeat(18)]) {
    assert.deepEqual(validateLogin({ email: values.email, password }), {});
  }
  for (const password of ["", "a".repeat(73), "😀".repeat(19)]) {
    assert.ok(validateLogin({ email: values.email, password }).password);
  }
  for (const email of ["", "not-an-email", "a@b", "a b@example.com", "a".repeat(65) + "@example.com"]) {
    assert.ok(validateLogin({ email, password: "x" }).email);
  }
});

test("signup sends only account fields and preserves the exact password", async t => {
  let sent;
  const password = "  a long unique passphrase  ";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, options };
    return Response.json({ user: { firstName: "Priya", email: "priya@example.com" } }, { status: 201 });
  });
  await signup({ ...values, firstName: " Priya ", email: " PRIYA@EXAMPLE.COM ", password,
    confirmPassword: password, dob: "1990-01-01", isAdmin: true });
  assert.equal(sent.url, "/api/user/signup");
  assert.equal(sent.options.credentials, "omit");
  assert.equal(sent.options.cache, "no-store");
  assert.deepEqual(JSON.parse(sent.options.body), { firstName: "Priya", lastName: "Sharma",
    email: "priya@example.com", password });
});

test("login sends credentials without trimming passwords and accepts the existing JWT response", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, options };
    return Response.json({ user: { firstName: "Priya", email: "priya@example.com" },
      token: "test-only-token", tokenType: "Bearer", expiresIn: 900 });
  });
  const data = await login({ email: " PRIYA@EXAMPLE.COM ", password: " ", extra: "ignored" });
  assert.equal(sent.url, "/api/user/login");
  assert.deepEqual(JSON.parse(sent.options.body), { email: "priya@example.com", password: " " });
  assert.equal(data.token, "test-only-token");
});

test("API errors show safe messages for validation, duplicates, credentials, limits and outages", async t => {
  for (const [status, action, message] of [
    [400, login, /check your details/], [401, login, /email or password is incorrect/],
    [409, signup, /already registered/], [429, login, /Too many attempts/],
    [500, login, /temporarily unavailable/], [503, signup, /temporarily unavailable/],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("private driver stacktrace", { status }));
    await assert.rejects(action(values), error => {
      assert.ok(error instanceof ApiError); assert.match(error.message, message);
      assert.doesNotMatch(error.message, /driver|stacktrace/);
      if (status === 409) assert.ok(error.fields.email);
      return true;
    });
    mock.mock.restore();
  }
});

test("network and malformed success responses fail safely without exposing internals", async t => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("private network error"); });
  await assert.rejects(signup(values), /try signing in before submitting again/);
  await assert.rejects(login(values), /couldn't connect/);
  network.mock.restore();
  for (const payload of [{}, { user: { firstName: "Priya", email: values.email } },
    { user: { firstName: "Priya", email: values.email }, token: "token", tokenType: "Bearer", expiresIn: 99999 }]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(login(values), /couldn't confirm the response/);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("<html>proxy error</html>"));
  await assert.rejects(login(values), /couldn't confirm the response/);
});
