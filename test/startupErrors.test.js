import test from "node:test";
import assert from "node:assert/strict";
import { startupFailureMessage } from "../backend/startupErrors.js";

test("startup diagnostics distinguish causes without exposing raw errors", () => {
  const sensitive = "mongodb://user:sensitive-password@host/private?token=secret";
  for (const [stage, code, expected] of [
    ["configuration", undefined, /invalid configuration/],
    ["database", undefined, /npm run db:start/],
    ["database", 18, /authentication failed/],
    ["database", 11000, /indexes/],
    ["database", 85, /indexes/],
    ["database", 86, /indexes/],
    ["http", "EADDRINUSE", /port is already in use/],
    ["http", "EACCES", /permission denied/],
    ["application", undefined, /application initialization failed/],
    ["application", "ENOENT", /frontend build is missing.*npm run build/],
  ]) {
    const error = Object.assign(new Error(sensitive), { code });
    const message = startupFailureMessage(stage, error);
    assert.match(message, expected);
    assert.doesNotMatch(message, /mongodb:\/\/|sensitive-password|token=secret/);
  }
  assert.match(startupFailureMessage("database", null), /MongoDB/);
});
