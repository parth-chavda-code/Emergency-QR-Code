# Emergency QR Code — milestone 1

Minimal Express and MongoDB application foundation. No business or health endpoints
are active. Existing routes, models, and authentication middleware are preserved
as inactive scaffolding; their feature dependencies must be restored and their
validation/security reviewed before mounting them in a later milestone.

## Run locally

1. Use Node.js 20.19 or newer (Node.js 24 works).
2. Run `npm ci`.
3. Copy `.env.example` to `.env` if you don't already have one. Set `dbconnection`
   to your MongoDB URI. Existing environment variables take precedence over `.env`.
4. Start a local MongoDB instance, or configure an accessible hosted MongoDB.
5. Run `npm start`, or `npm run dev` for automatic restart during development.

`PORT` defaults to 3000. `NODE_ENV` defaults to development and accepts development,
test, or production. `JWT_SECRET` is not used by this milestone. Keep `.env` private.
MongoDB is a separate service; starting this backend does not install or start it.

## Structure and behavior

- `backend/app.js`: `createApp()` configures Express without opening sockets or
  connecting to MongoDB. Import it directly in application tests.
- `backend/config.js`: loads the root `.env` and validates startup configuration.
- `backend/db.js`: connects/disconnects MongoDB with bounded timeouts and query
  buffering disabled. Automatic index creation is disabled for this foundation.
- `backend/server.js`: connects before listening, handles startup failure and
  termination, and closes HTTP/database resources within a 10-second deadline.
- `backend/middlewares/errors.js`: consistent JSON errors without internal details.

Unknown routes return `404`; malformed JSON returns `400`; JSON bodies above 16 KiB
return `413`; unsupported encodings and compressed JSON return `415`; unexpected application errors
return `500`. Errors have the shape `{ "error": "message" }`. There are no successful
business API operations yet. Status handling for future database-backed endpoints
must be implemented when those endpoints are added.

Invalid configuration, unavailable MongoDB, and an occupied port cause startup to
fail with a nonzero exit code. Logs deliberately omit raw errors that may contain
credentials. A later database disconnect allows the driver to reconnect; no
database-backed routes are active yet.

Run `npm test` for isolated configuration, HTTP response, and startup-failure checks.
Set `TEST_MONGODB_URI` to an isolated test database URI when running `npm test` to
also verify connected startup, SIGINT/SIGTERM shutdown, and occupied-port failure.
These integration checks are skipped by default and never use your configured URI.
Run `npm audit` to check the locked dependency tree against current advisories.
Development restart uses Node's built-in watch mode; no additional package is needed.
