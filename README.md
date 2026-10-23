# Emergency QR Code — foundation, authentication, and safe profile storage

Express and MongoDB backend. Authentication endpoints are `POST /user/signup`,
`POST /user/login`, and `POST /user/logout`.
Owner profile endpoints are `POST`, `GET`, and `PATCH /user/profile`.
QR management endpoints are under `/user/qr-credentials`; the owner-only public
preview is `GET /user/profile/public-preview`. Public scanning is not active yet.

## Run locally

1. Use Node.js 20.19 or newer (Node.js 24 works).
2. Run `npm ci`.
3. Copy `.env.example` to `.env` if you don't already have one. Set `dbconnection`
   to your MongoDB URI. Existing environment variables take precedence over `.env`.
4. Set `JWT_SECRET` to a private random value. To generate a value locally, run
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
   and put the output in your `.env`. Never share the secret or commit it.
   Run the same command again to generate a **different** value for
   `PROFILE_ENCRYPTION_KEY`. This key must be 64 hexadecimal characters (32 random
   bytes). It protects profile contents and must not be the JWT secret.
5. Start MongoDB locally, or configure an accessible hosted MongoDB. For this
   machine's existing development replica set, run `npm run db:start` in its own
   terminal and keep it open. This uses the existing data on port 27018; it does not
   initialize, migrate, or delete anything. It requires `mongod` on your PATH and
   the existing `$HOME/.local/share/emergency-qr-mongo` directory.
6. In a second terminal, run `npm start`, or `npm run dev` for Node's built-in
   automatic restart. Keep it open after `Backend listening on port 3000`.
7. For the frontend, use a third terminal: `npm --prefix frontend run dev`.

`npm start` starts only the backend, not MongoDB or Vite. After a restart or when
its terminal closes, the local database may need starting again. If Vite reports
`ECONNREFUSED 127.0.0.1:3000`, the backend is not reachable: check its terminal first.
Startup messages now distinguish configuration, database/index, and port failures
without printing secrets. An occupied port means an existing process is listening;
do not repeatedly launch more copies. For a database failure, confirm that `.env`
points to the same instance you started (this setup uses 27018, not 27017).

`PORT` defaults to 3000. `NODE_ENV` defaults to development and accepts development,
test, or production. `JWT_SECRET` is required and must be at least 32 bytes long.
Length validation cannot prove randomness: use a generated secret. Keep `.env` private.
`PROFILE_ENCRYPTION_KEY` is also required at startup. Do not regenerate it during
normal restarts: profiles encrypted with the old key cannot be read with a new key.
Keep a secure copy separate from database backups. Losing it loses access to profile
contents. Key rotation requires a planned re-encryption process, not an `.env` edit.
MongoDB is a separate service; starting this backend does not install or start it.
`PUBLIC_BASE_URL` defaults to `http://localhost:<PORT>` outside production. In
production it is required and must be a stable HTTPS origin, without credentials,
path, query, or fragment. It is used to construct QR links, never taken from request
headers. Localhost links work only on the machine opening them, not another phone.
QR issue/activate/revoke require a transaction-capable MongoDB deployment (replica
set or sharded cluster). A standalone database still supports existing auth/profile
features and QR reads, but QR mutations return safe `503`s without partial changes.

### VS Code editor setup

This backend runs JavaScript directly; it has no TypeScript build step. The
development-only `typescript` and `@types/node` packages support editor diagnostics
and autocomplete. TypeScript is pinned to 5.8.3, matching the installed MongoDB
driver's own development compiler, because that driver's shipped configuration is
not compatible with TypeScript 6's changed configuration rules. Runtime packages
and the driver configuration inside `node_modules` are unchanged.

After `npm ci`, open a backend JavaScript file, run **TypeScript: Select TypeScript
Version** from the Command Palette, and choose **Use Workspace Version (5.8.3)**.
Run **TypeScript: Restart TS Server** if old diagnostics remain. Selecting the
workspace version takes precedence over the TypeScript Nightly extension for this
workspace. `jsconfig.json` scopes this JavaScript project to backend/scripts/tests
and does not emit or compile files. Imported package declarations can still be
used for autocomplete; dependency source files are not project entry points.

Do not edit `node_modules/mongodb/tsconfig.json` or add `ignoreDeprecations` there:
dependency edits would disappear after reinstalling. Production can use
`npm ci --omit=dev`; these editor tools are not needed to run the server.

## Signup

Send JSON to `POST /user/signup` with `Content-Type: application/json`:

```json
{
  "email": "person@example.com",
  "firstName": "Parth",
  "lastName": "Chavda",
  "password": "A long unique passphrase!"
}
```

- All four fields must be strings and are required; additional fields are rejected.
- Email is trimmed, lowercased, and syntax-validated (maximum 254 characters;
  local part maximum 64). Syntax validation does not verify ownership or delivery.
- Names are trimmed, required, and limited to 100 Unicode code points each.
  International names and punctuation are accepted; control characters are rejected.
  The 100-character limit is a project choice, not a universal naming standard.
- Signup passwords must have at least 10 characters, including an uppercase
  letter, a lowercase letter, and a special character, and use at most 72 bytes.
  Unicode letters are supported; punctuation and symbols count as special
  characters, while spaces and digits do not. A digit is not required.
  Spaces and Unicode are accepted. A normal English letter uses one
  byte; many other characters use more (for example, an emoji can use four bytes).
  Longer passwords return `400` instead of being silently cut off by bcrypt.
  Passwords are never trimmed.
- Signup uses `await bcrypt.hash(password, 10)`. bcrypt creates a fresh random salt
  automatically; 10 controls how much work hashing takes. The `password` database
  field stores only the resulting bcrypt hash. Login uses `bcrypt.compare`.
  This uses bcrypt's normal API without a custom password-hashing helper.
- `createdAt` is generated by Mongoose. Clients cannot supply account timestamps.

Successful signup returns `201` and only public account fields:

```json
{
  "user": {
    "id": "MongoDB-generated ID",
    "email": "person@example.com",
    "firstName": "Parth",
    "lastName": "Chavda",
    "createdAt": "ISO timestamp"
  }
}
```

The model excludes `password` from normal queries and removes it during document
serialization. The endpoint uses an explicit response field list as well.

| Status | Meaning |
| --- | --- |
| 201 | Account created |
| 400 | Missing/invalid fields, extra fields, or malformed JSON |
| 409 | Email already registered, including concurrent duplicate attempts |
| 413 | JSON body exceeds 16 KiB |
| 415 | Unsupported content type/encoding or compressed JSON |
| 429 | More than 20 signup attempts per IP in 15 minutes |
| 503 | Database unavailable/timed out |
| 500 | Unexpected internal failure |

Errors use `{ "error": "message" }`; request validation also includes safe field
messages in `errors`. Responses never include password values, driver errors,
connection strings, or stack traces. `429` and `503` include `Retry-After`.

Rate limiting is held in memory per application instance and resets on restart.
Forwarded IP headers are ignored; configure a trusted proxy and shared rate-limit
store when deploying multiple backend instances. The email-conflict response
reveals that an account exists, as expected by this signup contract.

## Login

Send JSON to `POST /user/login` with `Content-Type: application/json`:

```json
{
  "email": "person@example.com",
  "password": "A long unique passphrase!"
}
```

Login reuses the email validation and lowercase normalization from signup. Its
password validation checks only that the value is a nonempty string of at most
72 bytes. It does not apply signup's strength rules or trim the password. Extra
fields are rejected. No separate login model or collection is needed.

The account query explicitly retrieves the hidden password hash. bcrypt compares
the supplied password with that hash. Unknown accounts and incorrect passwords
both receive `401` with `{ "error": "Invalid email or password" }`. Unknown emails
also perform a bcrypt comparison against a dummy hash to reduce timing differences;
this does not guarantee identical request timing.

Successful login returns `200`:

```json
{
  "token": "signed JWT",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "MongoDB-generated ID",
    "email": "person@example.com",
    "firstName": "Parth",
    "lastName": "Chavda",
    "createdAt": "ISO timestamp"
  }
}
```

Tokens use HS256 and identify the user through `sub` (the user ID) and the login
session through `sid` (the session ID). They contain issue/expiry times and
issuer/audience fields; no password, hash, email, or medical data.
They expire after 15 minutes. The response is marked `Cache-Control: no-store`.
Refresh tokens and automatic renewal are not implemented; log in again after expiry.
Tokens are returned as JSON and sent in the `Authorization: Bearer <token>` header.
No cookies are used. Browser storage remains a frontend decision. Use HTTPS when
deployed, and never log passwords or tokens.

After verifying the password, login creates an `auth_sessions` record with the user
ID, account login version, and an expiry matching the token's 15-minute expiry.
It checks that the session is still active before returning the token. Session
creation failure never returns a token. Token signing happens before session
creation, so signing failure leaves no session behind. If a later check fails,
an unused session record may remain until expiry; the client receives no token.
Login overlapping global logout can return `401` asking the owner to log in again.

| Status | Login result |
| --- | --- |
| 200 | Correct credentials; JWT and public user fields returned |
| 400 | Invalid/missing fields, extra fields, or malformed JSON |
| 401 | Unknown email, incorrect password, unsupported stored password format, or session invalidated during login |
| 413 | JSON body above 16 KiB |
| 415 | Unsupported content type/encoding or compressed JSON |
| 429 | More than 10 attempts per IP in 15 minutes; includes `Retry-After` |
| 503 | Database unavailable/timed out; includes `Retry-After` |
| 500 | Unexpected password-check or token-creation failure |

Login and signup have separate limits. The login limit counts successful and
failed attempts, uses memory, and resets on restart.

## Authentication middleware

For logout, owner profile endpoints, and future protected routes, `authUser` reads:

```text
Authorization: Bearer <token>
```

It verifies the signature, HS256 algorithm, issuer, audience, 15-minute expiry,
and user/session ID fields. It then reads the session and account from MongoDB.
The session must belong to that account, be unexpired and unrevoked, and carry
the account's current login version. Deleted accounts are rejected too.
It sets `req.userId`, `req.sessionId`, and `req.loginVersion` from verified data,
never from the request body. Missing/invalid/expired authentication returns `401`.
An unavailable database returns `503` with `Retry-After: 5`; no protected access is
granted. Unexpected failures return a generic `500`. Request failures do not shut
down the app. Protected responses are marked `Cache-Control: no-store`.

Owner profile handlers use `req.userId` to check ownership. Authentication tests
also mount a temporary test-only route. Deleting a token on the client alone does not
revoke a copied token; the logout endpoint performs server-side invalidation.

## Logout and session lifecycle

Send `POST /user/logout` with `Authorization: Bearer <token>`. No request body is
needed. Body-supplied IDs or tokens do not choose the account or authenticate it.
Logout always applies to **every device** for the verified account.

The user record has an internal `loginVersion`, initially zero. Sessions remember
the version used at login. Logout atomically increases the account version, so all
older sessions stop authorizing requests even if their JWTs have not expired.
Old session rows are also marked revoked for inspection. If that bookkeeping write
fails, the version change still blocks them. Concurrent logout requests compare
the version they authenticated with, preventing an older request from invalidating
a fresh login. Requests already authenticated and in progress may finish.

| Status | Logout result |
| --- | --- |
| 204 | All earlier login sessions invalidated; empty response body |
| 401 | Missing/invalid/expired token, inactive session, or another logout already invalidated this session |
| 503 | Authentication database lookup or account-version update unavailable/timed out |
| 500 | Unexpected internal failure |

The global JSON parser can also return `400`, `413`, or `415` if a client sends a
malformed, oversized, or unsupported encoded JSON body. A failed write can have an
uncertain outcome during a network interruption; an error never grants access or
guarantees that the session stayed active. Log in again if needed.

Successful login/logout actions attempt a minimal audit write containing only the
action, account ID, and timestamp. Audit failures emit a generic warning without
secret details; they do not reverse completed authentication changes. MongoDB's
eventual session expiry cleanup is housekeeping: middleware checks expiry itself.

Accounts and sessions must contain a valid `loginVersion`. Missing values are not
treated as zero or automatically upgraded. New records still default to zero.
JWTs issued before session support lack `sid` and require a fresh
login. No secret changes or data deletion are needed. Public QR access remains
independent of login/logout. Refresh tokens, email verification, and password reset
remain outside this milestone.

## Structure and startup

- `backend/app.js`: `createApp()` configures Express without connecting or listening.
- `backend/config.js`: loads the root `.env` and validates startup configuration,
  including the required JWT secret. Server startup passes this configuration into
  `createApp`; the app and middleware do not load `.env` themselves.
- `backend/db.js`: connects with bounded timeouts and disables query buffering.
  Automatic index creation is enabled. Startup waits for all registered models'
  indexes before HTTP can accept requests. The user's email index ignores case,
  including mixed-case addresses previously stored by older code.
- `backend/server.js`: starts HTTP after database/index initialization and closes
  HTTP/database resources on termination with a 10-second shutdown deadline.
- `backend/models/user.js`: user schema, validation, timestamps, and unique index.
- `backend/validation/user.js`: shared email/password validation plus signup/login schemas.
- `backend/routes/user.js`: signup/login, separate attempt limits, and safe failures.
- `backend/middlewares/authMiddleware.js`: JWT verification for future protected routes.
- `backend/security/authSessions.js`: session creation/checks, logout across devices,
  and minimal authentication audit writes.
- `backend/routes/profile.js`: authenticated owner-only create/read/partial update,
  conditional revision checks, safe responses, and minimal profile audit events.
- `backend/middlewares/errors.js`: safe generic errors and unknown-route `404`s.

Invalid configuration, unavailable MongoDB, index creation failure (for example,
existing duplicate emails), and an occupied port fail startup with a nonzero exit
code. Startup does not delete accounts, rewrite passwords, or remove old indexes.
Existing accounts are not rewritten. If you created accounts with the previous
scrypt signup, their stored hashes remain scrypt and cannot be converted without
knowing the original passwords. If you need those accounts, a password reset or
migration flow will be needed before their owners can log in again.
Login safely rejects scrypt accounts with the same generic `401`; it does not
rewrite or delete them. New signup always creates bcrypt hashes.

Owner profile endpoints and public `GET /e/:token` are active. The old prototype
`/emergency/:token` route remains unmounted.
No health endpoint is exposed. Profile deletion is not implemented yet.
The previous `/userSignup/signup` address is no longer active.

## Milestone 2: storage foundation

This milestone added storage rules and helpers, not profile or QR endpoints.
Milestone 4 added owner profile endpoints, and Milestone 5 adds QR management and
owner preview alongside signup/login/logout. Milestone 6 adds public emergency reads.

| Collection | Contents and database rules |
| --- | --- |
| `users` | Existing account data; unchanged by this milestone |
| `emergency_profiles` | One profile per user; encrypted private payload and public snapshot, consent, revision, timestamps |
| `qr_credentials` | Profile reference, unique SHA-256 token digest, pending/active/revoked state, replacement reference, timestamps; one active and one pending QR per profile |
| `auth_sessions` | User reference, account login version, expiry, revocation time, timestamps; expired records are eventually removed |
| `audit_events` | Approved action name, actor/reference IDs, creation time; no arbitrary text or sensitive payload |

### Profile input and consent

`backend/validation/profile.js` requires a display name (1–100 characters) and a
valid non-future DOB in `YYYY-MM-DD` form. DOB is a calendar date, not a timestamp.
Blood type is optional and must be one of the eight standard ABO/Rh labels when
provided. An unknown blood type should be omitted, not guessed.
Allergies, medical conditions, medications, and emergency contacts can be empty.
For now, each medical list allows 30 entries, each up to 500 characters. Contacts
allow up to 5 entries with a name, an international-format phone number starting
with `+` (up to 15 digits), and an optional relationship. These are MVP size limits;
phone format validation does not verify that a number belongs to the contact.
Unknown fields and non-boolean consent values are rejected.

`sharingConsent` has these categories: `displayName`, `age`, `bloodType`,
`allergies`, `medicalCondition`, `medications`, `emergencyContact`. Each defaults
to false. Consent shares the whole category, including entries added later while
that category remains shared. DOB is never a public category. Emergency contacts
are optional; no contact is required to create a profile or issue a future QR.

`backend/security/profileStorage.js` validates input before creating the two
encrypted payloads. Call `prepareProfileStorage(profileId, input, key)` with the
profile's actual ID, and save both payloads and consent together. The profile PATCH
handler merges changes with the stored information and consent before calling this
helper, so omitted PATCH fields are preserved. It enforces owner identity and
conditionally matches the database revision to reject stale edits with `409`.

`readPublicSnapshot(profile, key)` returns only currently consented categories.
If age sharing is enabled, it calculates age from private DOB at read time. The
stored snapshot contains neither DOB nor a fixed age. Birthdays use the UTC
calendar; a February 29 birthday increments on March 1 in non-leap years. Owner
responses include private DOB for future frontend age display. Public responses
never return DOB.

QR issuance requires the revision returned with the owner public preview and at
least one shared, nonempty field/category. A completely private profile can still
be saved. Emergency contacts are never compulsory. Milestone 5 implements the
preview and issuance checks; frontend preview/download screens come later.

### Encryption and QR tokens

`backend/security/profileEncryption.js` uses Node's built-in AES-256-GCM with a
fresh random 12-byte IV and a 16-byte authentication tag. Stored envelopes contain
`version`, `iv`, `tag`, and `ciphertext`; none is the secret key. Version 1 is the
only supported format. Encryption binds each payload to its profile ID and purpose,
so moving it to a different profile or swapping private/public payloads fails.
Wrong keys, altered content, or unsupported formats fail with a generic error.
This protects profile contents in a database-only leak, not a compromised server
that also has the encryption key. Ownership, consent, revisions, and timestamps
remain readable. The helper limits each plaintext JSON payload to 64 KB.

The profile model accepts encrypted envelopes, rejects prototype/plaintext fields,
and hides both envelopes from ordinary queries. Future authorized handlers must
explicitly select the needed payloads, use a plain record (`.lean()` or
`.toObject()`), and decrypt them. A valid-looking envelope
is not proof of correct encryption; writing code must use the storage helper.

`backend/security/qrToken.js` generates 32 random bytes as a URL-safe token and
returns `{ token, tokenDigest }`. Only `tokenDigest` belongs in a QR database record.
The raw token is returned only by issuance and cannot be recovered from its digest
later. The model rejects raw-token fields. Milestone 5 implements issuance, state
changes, permanent revocation, and atomic replacement. Public resolution, QR-image
rendering, and profile/account deletion behavior remain future work.

Milestone 2 introduced session/audit models. Milestone 3 now connects sessions to
login and middleware, implements logout across devices, and records login/logout
actions. Milestone 4 records profile create/update actions. Milestone 5 records QR
actions inside the same transaction as the state change. Audit retention policy
remains future work.
Email verification, password reset, deployment key management, and backup retention
remain future decisions.

Encryption API reference: [Node.js crypto documentation](https://nodejs.org/api/crypto.html).

### Explicit prototype reset

The old collection is `emergencyprofiles`; the new collection is
`emergency_profiles`. Ordinary startup never deletes or migrates records.
For the approved disposable prototype data only, run:

```sh
node scripts/reset-prototype-profiles.js --reset-prototype-profiles
```

This drops only the old `emergencyprofiles` collection and its indexes, checks that
the user count is unchanged, then initializes new collections/indexes. It does not
delete users or new-model records. Without the explicit flag it makes no database
changes. Repeating it after the old collection is gone preserves new data. If setup
fails after the drop, the old disposable data is already removed; fixing the issue
and repeating setup is safe. Do not use this script on data that needs preservation.

### Milestone 2 review

1. Inspect `backend/validation/profile.js`: name/DOB required, categories optional,
   sharing off by default, strict input limits.
2. Inspect `backend/models/emergency_profile.js` and `backend/security/profileStorage.js`:
   one owner profile, encrypted storage, consent filtering, current age without public DOB.
3. Inspect `backend/models/qr_credential.js` and `backend/security/qrToken.js`:
   digest-only storage, unique digest, one active QR per profile.
4. Inspect `backend/models/auth_session.js` and `backend/models/audit_event.js`:
   small models with no passwords, token strings, or medical fields.
5. Inspect `scripts/reset-prototype-profiles.js`: explicit reset limited to the old
   collection. Confirm collection names, counts, and indexes in MongoDB, without
   sharing `.env` values.
6. Review `test/storage.test.js` for wrong-key/tampering rejection, consent filtering,
   birthday calculation, encrypted database records, unique indexes, and reset safety.

## Verification

Run `npm test` for request validation, error handling, rate limiting, configuration,
and startup failure checks. Set `TEST_MONGODB_URI` to an isolated test database URI
when running tests to also verify real signup, salted hashing, automatic indexing,
concurrent duplicate requests, login, JWT verification/failures, HTTP startup,
shutdown, occupied-port failure, encrypted storage, profile/QR uniqueness, and
prototype reset safety. Storage encryption/validation tests run without MongoDB too.
`test/logout.test.js` checks multiple logins, global logout, account isolation,
fresh login, old tokens/accounts, missing/expired/revoked/mismatched sessions,
overlapping login/logout, audit failures, and database failures.
Integration checks are skipped by default and do not load your `.env` database URI.
Integration tests insert accounts into the supplied test database; use a disposable
instance. The index-failure test creates and deletes its own temporary database.

Run `npm audit` to check the locked dependency tree against current advisories.

## Review this implementation

1. Inspect `backend/routes/user.js`: signup uses bcrypt hashing; login compares the
   password and returns a 15-minute JWT with public user fields only.
2. Inspect `backend/validation/user.js`: login only requires email and a nonempty
   password within 72 bytes; signup retains its existing strength rules.
3. Inspect `backend/middlewares/authMiddleware.js`: verified ID goes into `req.userId`;
   invalid tokens return `401` without stopping the server.
4. Inspect `backend/config.js` and `.env.example`: the secret is required. The real
   value belongs only in ignored `.env`; do not include it in review screenshots.
5. In Postman or a similar API client, use `http://localhost:3000` (or your configured
   port). Create a fresh account with the signup JSON above: expect `201`. Log in
   using the same credentials: expect `200`, a token, and `expiresIn: 900`.
6. Change only the password: expect `401`. Omit it: expect `400`. Send more than
   10 login requests within 15 minutes: expect `429` on the next request. You can
   restart the local server to reset the in-memory limiter for another review.
7. Middleware expiry, altered-token rejection, and the verified user identity are
   demonstrated in `test/login.test.js`; they do not require a new product endpoint.

## Milestone 3 review: sessions and logout

1. `backend/routes/user.js`: login creates a session; `/user/logout` uses the verified
   account and returns `204` after global logout. Signup's public contract is unchanged.
2. `backend/security/authSessions.js`: session ownership/expiry checks, account login
   version comparison, atomic version increase, and safe audit handling.
3. `backend/middlewares/authMiddleware.js`: missing/invalid sessions return `401`;
   database failures return `503`; caller-supplied IDs never grant access.
4. `backend/models/user.js` and `backend/models/auth_session.js`: internal login
   version fields. The account version is hidden from queries/serialization unless
   explicitly requested for authentication.
5. In Postman, log in twice to the same account and save tokens A and B privately.
   Optionally log in to a different account and save token C. POST `/user/logout`
   with token A in the Authorization Bearer header and no body: expect `204`.
   Repeat using B: expect `401`. C must still be able to log out with `204`.
   Log in again to the first account and confirm its new token can log out with `204`.
6. Review `test/logout.test.js`: its temporary protected endpoint proves both tokens
   lose private access without adding a demo endpoint to the real app. It also covers
   race conditions and failures that are harder to reproduce manually.
7. No cookies, new packages, collection reset, or secret changes are part of this update.

Password guidance: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Milestone 4: owner profile API

All three endpoints require `Authorization: Bearer <token>` from a fresh login.
POST/PATCH also require `Content-Type: application/json`. They use only the account
ID verified by authentication; body IDs are rejected and query IDs cannot select
another profile. Every account has at most one profile.

### Create: POST /user/profile

Name and DOB are required. All other categories can be omitted. Example:

```json
{
  "displayName": "Profile Owner",
  "dob": "1995-05-20",
  "bloodType": "O+",
  "allergies": ["Example allergy"],
  "sharingConsent": {
    "bloodType": true
  }
}
```

Returns `201` with `{ "profile": { ... } }`. The profile object contains `id`,
validated profile contents, all `sharingConsent` choices, `revision` (initially 1),
`createdAt`, and `updatedAt`. Omitted lists become empty and omitted consent choices
become false. Blood type can be omitted, but `null` is only accepted by PATCH to
clear it. A second profile returns `409`.

### Read: GET /user/profile

Returns `200` with the same response structure, or `404` if no profile exists.
This is the authenticated owner's full profile, including private categories and
DOB regardless of sharing settings. It is not a public QR response. Encrypted
envelopes, user IDs, keys, tokens, and password data are excluded from the profile
response. Responses use `Cache-Control: no-store`.

### Edit: PATCH /user/profile

Send the last revision received, plus at least one change:

```json
{
  "revision": 1,
  "medications": ["Example medication"],
  "sharingConsent": {
    "medications": true
  }
}
```

Only supplied fields change. Omitted consent choices stay as they were; this does
not reset every category to private. Arrays replace their entire category; `[]`
clears one. `"bloodType": null` clears blood type. Name and DOB cannot be cleared.
Empty edits and empty `sharingConsent` objects are rejected. Revisions must be
positive safe integers with room to increment.

The handler decrypts the owner's profile, merges and validates the changes, then
rebuilds both encrypted payloads. It saves private contents, the approved public
snapshot, consent, and the incremented revision in one conditional document update.
If another request changed the revision, it returns `409` without overwriting that
edit. Reload the profile and review the newer values before retrying. An accepted
update returns `200` with the full updated owner profile and its next revision.
Unchanged values explicitly sent again still count as an edit and increment it.

Each JSON request is limited to 16 KiB. Complete private contents, including merged
edits, are limited to 64000 UTF-8 bytes so the encryption helper's size limit fails
as a safe validation error rather than an unexpected encryption failure.

### Errors and audit records

| Status | Meaning |
| --- | --- |
| 400 | Invalid/missing fields, extra fields, malformed JSON, invalid revision, or empty edit |
| 401 | Missing/invalid/expired authentication or inactive session |
| 404 | No profile for the authenticated owner |
| 409 | Profile already exists, or revision changed before the edit could be saved |
| 413 | JSON request exceeds 16 KiB |
| 415 | Unsupported request content type/encoding |
| 503 | Database unavailable/timed out; includes `Retry-After: 5` |
| 500 | Unexpected failure, including unreadable encrypted profile contents |

Validation errors use generic messages without echoing medical input. Decryption
failures never return partial data. Create/update actions attempt an audit record
with the action, owner/profile IDs, and timestamp. Audit failure logs only a generic
warning and does not undo a saved edit. Audit records do not contain health data,
contact information, DOB, tokens, or encryption keys. A network failure during a
write may leave the outcome uncertain; GET the profile before retrying a write.

Milestone 4 did not add deletion, QR management, public scanning, or frontend
screens. Milestone 5 now adds QR management and public preview (below). No schema
reset, new package, or secret change is required. The old `/profile/create` and
`/profile/update` prototype addresses remain inactive.

### Milestone 4 review checklist

1. Review `backend/routes/profile.js`: authenticated create/read/PATCH, ownership
   filters, explicit responses, conditional revision writes, and safe audit handling.
2. Review `backend/validation/profile.js`: create defaults versus PATCH omission,
   strict allowed fields, required name/DOB, and optional blood-type clearing.
3. Review `backend/security/profileStorage.js`: decrypted private input validation
   and reuse of encrypted private/public snapshot preparation.
4. In Postman, sign up a fresh test account and log in. POST `/user/profile` with
   name/DOB: expect `201`. GET it: expect `200`, all consent false, revision 1.
   POST again: expect `409`.
5. PATCH revision 1 with medications and only medication-sharing consent: expect
   revision 2 and untouched data/consent preserved. Reuse revision 1: expect `409`.
   PATCH revision 2 with `"medications": []`: expect revision 3 and an empty category.
6. Log in to another account. GET must show only that account's profile or `404`.
   Supplying the first user's ID must not grant access to their profile.
7. Inspect `emergency_profiles` in MongoDB: medical contents and DOB must be
   encrypted, including the public snapshot. Never share the encryption key.
8. Review `test/profile.test.js`: forced concurrent edits, duplicate creation,
   logout, consent refresh, corrupted encryption, and safe failure checks.

## Milestone 5: QR credential lifecycle

All endpoints below require a current JWT in the Authorization Bearer header.
Responses are marked `Cache-Control: no-store`. This milestone manages credentials
and returns link data; it does not render QR images. Milestone 6 enables `/e/:token`
(documented below).
Do not enable the old prototype public emergency route against these models.

### Preview before issuance

`GET /user/profile/public-preview` returns:

```json
{
  "publicProfile": { "displayName": "QR Owner" },
  "profileRevision": 1,
  "hasSharedInformation": true
}
```

Only currently consented categories are included; private medical/contact fields
and DOB are excluded. Age, including zero for a newborn, is calculated when this
request runs if consent allows it. Empty arrays do not satisfy the sharing
requirement. A missing profile returns `404`. This is owner-only, not a public URL.
The frontend will present this data for review before issuing a QR.

### Issue, list, activate, revoke

| Endpoint | Behavior |
| --- | --- |
| `POST /user/qr-credentials` | JSON `{ "profileRevision": 1 }`; returns `201` with pending credential metadata, `token`, and `qrUrl` once |
| `GET /user/qr-credentials` | Returns `200` with `credentials` metadata and `nextCursor`; never tokens, digests, or full QR URLs |
| `POST /user/qr-credentials/:id/activate` | Returns `200` with the activated credential; replaces the linked old active QR atomically |
| `POST /user/qr-credentials/:id/revoke` | Returns `200` with the permanently revoked credential |

Issuance requires application/json and a current preview revision; unexpected
fields such as owner ID, token, state, or public URL are rejected. Activation and
revocation need no body. If one is supplied, only an empty JSON object is accepted.
Credential IDs must be valid database IDs. Ownership is always resolved from the
logged-in account's profile; an ID belonging to another owner returns `404`.

Credential metadata consists only of `id`, `state`, `replacesCredentialId`,
`createdAt`, `updatedAt`, `activatedAt`, and `revokedAt`. List pagination uses
`?limit=20&cursor=<id>`; limit defaults to 20 and must be 1–50. Results are sorted
by descending credential ID; use `nextCursor` for the next page. Unknown list
parameters are rejected. Having a profile with no credentials returns an empty
list; having no profile returns `404`.

Each profile can have at most one active and one pending credential. The first QR
also starts pending. A pending QR cannot resolve publicly.
Issue another only after activating or revoking the current pending one. Issuing
does not revoke the active QR, so a printed old card can keep working while its
replacement is downloaded/printed. Issuance records the active credential it is
intended to replace. Activation refuses to replace a different unexpected active
credential. If the old credential was already revoked urgently, the pending one
can still be activated.

Repeating activation of the currently active credential returns its state without
another activation audit event. Repeating revocation returns its revoked state.
Revoked credentials cannot reactivate. Lists cannot reconstruct the one-time
token/link: save the issuance response privately, or revoke the pending credential
and issue a replacement if it was lost. No full URL or raw token is persisted.

Issuance/activation require shared, nonempty information. Later making everything
private does not revoke an already active credential; the preview becomes empty.
The public resolver then shows the generic unavailable response. Sharing again
will restore that same active QR's usefulness. Changing profile contents never
requires rotating the credential by itself.

### Transactions, indexes, and failure behavior

`backend/security/qrCredentials.js` performs mutations in MongoDB transactions with
a 10-second client-side budget, primary reads, snapshot consistency, majority write
acknowledgment, and a bounded commit. The helper checks deployment capability first;
it never falls back to a sequence of independent writes on standalone MongoDB.

A hidden `qrChangeVersion` counter on the profile is written inside each QR
transaction. This coordinates QR actions with each other and with simultaneous
profile edits. It does not change the owner's content `revision`, `updatedAt`, or
encrypted payloads. A new unique index enforces one pending credential per profile,
alongside the existing one-active and unique-digest indexes. Startup waits for these
indexes; conflicting existing data causes safe startup failure rather than deletion.

For replacement, revoking A, activating B, updating the internal counter, and
recording QR audit events commit together or roll back together. QR audit failure
therefore returns an error and rolls back the QR action, unlike the best-effort
audit writes on existing auth/profile endpoints. No medical values, DOB, token,
digest, or full URL are included in QR audit records or application error logs.

| Status | Meaning |
| --- | --- |
| 200 | List, preview, activation, revocation, or safe repeat action succeeded |
| 201 | A pending credential was issued |
| 400 | Invalid ID, body, preview revision format, or list options |
| 401 | Invalid/expired/revoked authentication |
| 404 | Profile or owned credential not found |
| 409 | Pending QR already exists, stale preview, no shared information, revoked activation, or conflicting state |
| 413 / 415 | Existing request size/content type/encoding protections |
| 503 | Database unavailable, uncertain transaction result, or transaction support unavailable; `Retry-After: 5` |
| 500 | Unexpected failure, including decryption or audit failure; no sensitive details |

If the connection drops during commit, the server may not know whether a write
committed. A `503` does not prove it was rolled back. Reload the credential list
before retrying. If issuance committed but its token response was lost, revoke
that pending credential and issue another. Do not automatically retry token
issuance as if it had no effect. Activation/revocation can safely be retried after
checking state.

### Local transaction-capable MongoDB without changing the existing database

A standalone MongoDB on port 27017 is not converted automatically. This machine's
separate development replica set is configured as `emergencyQrDev` on port 27018,
with persistent files in `$HOME/.local/share/emergency-qr-mongo`. Its backend `.env`
uses that new database; the earlier configuration is saved privately in ignored
`.env.before-replica`. Existing standalone records were not migrated or deleted.

After a reboot, start this instance with the command below (do not start another
copy while port 27018 is already in use). It runs in the foreground; keep its
terminal open. This MongoDB build does not support `--fork` on macOS.

```sh
mkdir -p "$HOME/.local/share/emergency-qr-mongo"
/opt/homebrew/bin/mongod --replSet emergencyQrDev --dbpath "$HOME/.local/share/emergency-qr-mongo" --port 27018 --bind_ip 127.0.0.1 --nounixsocket
```

Initialization below is only for a fresh setup on another machine/directory. It
has already been completed on this machine; do not repeat it on each restart.
From another terminal at the project root, initialize a fresh set once:

```sh
node --input-type=module <<'JS'
import mongoose from 'mongoose';
const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27018/admin?directConnection=true');
try {
  await client.connect();
  await client.db('admin').command({replSetInitiate: {
    _id: 'emergencyQrDev', members: [{_id: 0, host: '127.0.0.1:27018'}]
  }});
  console.log('Development replica set initialized.');
} finally { await client.close(); }
JS
```

After it becomes primary, choose this new empty development database in private
`.env`: `dbconnection=mongodb://127.0.0.1:27018/emergency_qr?replicaSet=emergencyQrDev`.
Create a fresh test account/profile there. Existing records on port 27017 are not
migrated or deleted. Start the backend with `npm start` in a separate terminal.
The development processes are not automatically restarted at login. This is a
local development setup, not a production deployment. Alternatively use a suitable
Atlas deployment. Printed production QRs require a
stable HTTPS domain in `PUBLIC_BASE_URL`; keep that domain working for their lifetime.

### Testing and review

Run `npm test` without database variables for non-integration checks. For the full
integration suite, `TEST_MONGODB_URI` must point to a disposable replica-set database,
for example `mongodb://127.0.0.1:27018/emergency_qr_test?replicaSet=emergencyQrDev`.
Never point tests at your application database. Set `TEST_STANDALONE_URI` to another
disposable standalone test database to include the standalone rejection test; that
case is skipped when the optional variable is absent.

`test/qr.test.js` verifies digest-only storage, preview privacy, newborn age,
owner isolation, bounded pagination, pending limits, replacement, lost downloads,
permanent revocation, concurrent actions, consent withdrawal, transaction rollback,
audit/database/decryption failures, logout, and standalone safety. Existing suites
still cover authentication, encrypted profiles, startup, and safe errors.

### Milestone 5 review checklist

1. Review `backend/routes/qr.js` and `backend/validation/qr.js`: authenticated routes,
   strict requests, bounded lists, safe responses, and empty action bodies.
2. Review `backend/security/qrCredentials.js`: ownership, shared-data checks, state
   transitions, atomic replacement, rollback, one-time token response, audit writes.
3. Review `backend/models/qr_credential.js` and `backend/models/emergency_profile.js`:
   unique pending/active indexes and the hidden QR counter.
4. On a transaction-capable test database, log in and create a profile with a shared
   display name. GET `/user/profile/public-preview`; note its `profileRevision`.
5. POST `/user/qr-credentials` with that revision. Expect `201` and save its link
   privately. GET the list: pending metadata only. A second issuance returns `409`.
6. POST `/:id/activate` with the returned credential ID. Issue another QR, then
   activate it. The list must show old revoked, new active, and no pending QR.
7. Revoke the active QR. Repeating revoke remains successful; activating a revoked
   QR returns `409`. Another account cannot activate/revoke these IDs.
8. Inspect `qr_credentials`: only digests, never raw tokens/full URLs. Do not share
   issuance responses in screenshots. Milestone 6 enables public resolution only
   after activation; pending and revoked links return `404`.

## Milestone 6: public emergency information

`GET /e/:token` requires no login. Anyone holding an active QR link can read the
categories its owner currently shares. The response is JSON; the visitor-facing
page and QR image rendering are future frontend work.

```json
{
  "publicProfile": {
    "displayName": "QR Owner",
    "age": 24
  }
}
```

Only consented categories appear: `displayName`, `age`, `bloodType`, `allergies`,
`medicalCondition`, `medications`, and `emergencyContact`. Consent covers each whole
category. Age is calculated from private DOB using the UTC date on every read;
DOB itself is never returned. Decrypted values are validated, including contact
fields. Responses exclude account IDs, email, revision, consent metadata,
passwords, encryption envelopes, token digests, and the token itself.

The server hashes the token and looks up only active credentials. It reads the
current profile and checks that its owner still exists. Global logout does not
disable public links. Profile/account deletion makes the link unavailable, even
if a credential was left behind; this milestone does not add deletion endpoints.
Reading a QR does not change profiles, credentials, sessions, or audit events.

| Situation | Status and response |
| --- | --- |
| Active credential, existing owner/profile, nonempty shared information | `200` with `publicProfile` |
| Malformed/unknown token, pending/revoked credential, missing owner/profile, or nothing shared | `404` with `{ "error": "Emergency profile unavailable" }` |
| Database failure | `503`, safe retry message, `Retry-After: 5` |
| Failed decryption, invalid decrypted values, or unexpected failure | `500` with `{ "error": "Internal server error" }` |
| More than 60 requests per minute from the same IP | `429` with a safe message and `Retry-After` |

Public responses, including errors, carry `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow, noarchive`.
The limiter is held in memory per app process; proxy IP headers are ignored with
the current local configuration. Before deploying multiple processes or a reverse
proxy, configure trusted proxies and a shared limit store as appropriate.

Consent/content changes apply on subsequent reads without issuing a new QR.
Making all categories private returns the generic `404` while leaving the
credential active; sharing again restores the same link. Replacing or revoking a
credential disables its old link. A request already in progress may finish during
a concurrent change; information already viewed cannot be recalled. Application
errors never log token URLs or medical data. Any future hosting/access logging
must also avoid recording raw public QR URLs.

### Milestone 6 review and manual checks

1. Review `backend/routes/publicEmergency.js`: unauthenticated route, limit,
   privacy headers, generic unavailable response, and safe failures.
2. Review `backend/security/publicEmergency.js`: digest lookup, active state,
   existing profile/account, current consent, public validation, and no writes.
3. Log in, save a profile with only the display name public, preview it, and issue
   a QR. Save the returned `qrUrl` privately. Opening it while pending returns `404`.
4. Activate the credential, then open its `qrUrl` without an Authorization header.
   Expect `200` containing only the shared display name. DOB/email must be absent.
5. Change a category's consent and read the same URL again: only the new public
   choices appear. With every category private, expect the generic `404`.
6. Share age and confirm a calculated number without DOB. Share contacts only if
   you want all saved contacts public; no contact is compulsory.
7. Revoke the QR or activate its replacement: the old URL must return generic
   `404`. Logout should not disable a QR that remains active.
8. Review `test/publicEmergency.test.js`. Run the full suite with
   `TEST_MONGODB_URI` and `TEST_STANDALONE_URI` pointing to disposable test databases
   as described above; never use a database containing real user information.

## Frontend: signup, login, and emergency profile

The `frontend/` directory contains a React app built with Vite and Tailwind CSS.
Its signup and login layouts follow the selected Stitch designs, with corrected
product wording. Signup creates an account separately from the emergency profile,
where DOB, medical information, and sharing settings are managed. QR management
is future frontend work. There are no unsupported encryption/compliance claims,
identity-verification controls, password recovery, or offline features. The
emergency profile screen is now available after login, as documented below.

### Run locally

Install frontend dependencies once from the project root:

```sh
npm --prefix frontend ci
```

Keep MongoDB and the backend running on port 3000. If the backend is not already
running, start it in a separate terminal with `npm start`. Start the frontend with:

```sh
npm run dev:frontend
```

Open `http://127.0.0.1:5173/#/login` or
`http://127.0.0.1:5173/#/signup`. `npm run dev` still starts only the backend;
its existing commands and dependencies are unchanged. Frontend development
requires Node 20.19+ on the 20.x line, or Node 22.12+; Node 24 is supported.
Vite uses a fixed port and refuses to silently switch when 5173 is occupied.

The browser sends account requests to `/user/signup` and `/user/login`.
Vite forwards `/user/*` to the same paths at `http://127.0.0.1:3000` during local
development. Production uses those same Express endpoints directly. If you change the backend port,
update the proxy target in `frontend/vite.config.js`. No CORS relaxation or
backend route change is needed. Backend secrets and the root `.env` are not
loaded by the frontend. Never put secrets in `VITE_*` variables: they are public
when included in a browser build.

### Account behaviour

- Signup requires first name, last name, email, password, and password confirmation.
  Confirmation is checked only in the browser and is never sent to the backend.
  Name limits count Unicode characters. Signup passwords need at least 10
  characters, an uppercase letter, a lowercase letter, a special character,
  and at most 72 UTF-8 bytes. Spaces do not count as special characters.
- Login accepts a nonempty password up to 72 UTF-8 bytes without signup strength
  checks. Neither form trims or changes passwords. Email is normalized to lowercase.
  Browser checks help users; the backend remains the final validation authority.
- Successful signup leads to login with email filled in and passwords cleared.
  There is no automatic login after signup.
- Successful login opens the emergency profile screen. The JWT stays in React
  memory only: no local storage, session storage, cookie, URL, or console logging.
  Refreshing clears it from this page. The UI clears its in-memory session after
  the returned 15-minute lifetime. Refreshing does not revoke the server session
  or log out other devices; the existing backend logout endpoint still does that.
- Pending forms disable inputs and submission to prevent accidental duplicates.
  Validation focuses the first invalid field; safe server errors use a focused
  alert. Switching pages discards a late response from the page you left.
- Duplicate email, wrong credentials, rate limits, unavailable service, malformed
  responses, and network failures have readable messages. Requests time out after
  15 seconds and are never automatically retried. If signup's outcome is uncertain,
  the message suggests trying login before submitting signup again.

Fonts are served locally from `frontend/public/fonts/`, with their SIL Open Font
Licenses. The pages do not request third-party font, icon, or analytics services.
Icons are small inline SVGs. Forms use visible labels, password-manager autocomplete,
show/hide password buttons, keyboard focus styles, and a skip-to-content link.
On narrow screens the signup form appears before the explanatory sidebar.

### Build, test, and review

```sh
npm run test:frontend
npm run build:frontend
npm run preview:frontend
```

Preview runs at `http://127.0.0.1:4173` and forwards `/user` to the local backend.
It is a local review server. For deployment, `npm run build` creates `frontend/dist/`
and `npm start` serves the built website and existing API routes from Express.
The built files do not contain Vite's proxy.
`frontend/dist/` and dependency folders are ignored by Git.

Review these files:

| File | What to check |
| --- | --- |
| `frontend/src/pages/Signup.jsx` | Account fields, confirmation, loading/errors, signup-to-login flow |
| `frontend/src/pages/Login.jsx` | Existing login rules, safe errors, success callback |
| `frontend/src/api.js` | Explicit account payloads, unchanged passwords, safe responses, timeout |
| `frontend/src/validation.js` | Distinct login/signup rules and Unicode byte limits |
| `frontend/src/App.jsx` | Page navigation, in-memory JWT, expiry, profile access, and global sign-out |
| `frontend/src/components/` and `frontend/src/index.css` | Shared layout, field accessibility, local icons, Tailwind styling |
| `frontend/vite.config.js` | Local API forwarding and no backend secret loading |
| `frontend/test/auth.test.js` | Validation boundaries, payload allowlists, API failures |

Manual checks: submit empty forms, enter mismatched signup passwords, create a
test account, try its email again, log in with a wrong password, then log in with
the correct one. Confirm refreshing returns to an empty login form. Check both
pages on phone and desktop widths and try keyboard navigation/password visibility.
The root `npm test` includes frontend unit tests alongside backend tests; database
integration tests still need the disposable database variables described above.

### Emergency profile screen

After login, `#/profile` loads `GET /user/profile` with the JWT in the Bearer
header. A `404` opens an empty creation form with every category private. A
network failure, unavailable server, or malformed response shows a retry state;
it must never be mistaken for a missing profile. Opening the address without a
current in-memory login shows the login form.

The screen follows the selected Stitch layout with the approved corrections:
basic details, optional medical lists, optional contacts, a Save profile button,
and a category-only Sharing choices sidebar. There are no QR cards, security
scores, medical dosage advice, fabricated system identifiers, or audit-history
claims. The sidebar is explicitly marked Saved choices or Unsaved choices and
contains no private field values. It is not a public QR preview.

- Required: display name (up to 100 Unicode characters) and a valid, nonfuture
  DOB. DOB has no public toggle. An owner-only age display uses the UTC date;
  public age continues to be calculated by the backend when a QR is opened.
- Optional: one of the eight blood types, up to 30 entries in each medical list
  (500 characters per entry), and up to five contacts. Each added contact needs a
  name and an international phone number; relationship is optional. Blank added
  rows must be completed or removed. Empty lists and no contacts are valid.
- Public/private controls apply to entire categories. Every new choice starts
  private; saved choices are loaded as-is. Editing values does not change consent.
  Toggling a control changes the draft only. Saving applies it to subsequent reads
  through any active QR. New entries in a shared category will also be shared.
- Creation sends an explicit payload to `POST /user/profile`. Editing sends only
  changed fields and the saved revision to `PATCH /user/profile`. Removing blood
  type sends `null`; clearing a list sends `[]`. Unchanged fields/consent are omitted.
- Browser validation mirrors the existing data rules, including the 64,000-byte
  stored private-data budget. The existing HTTP request limit is separately
  16 KiB. Oversized change payloads are rejected before sending with a helpful
  message; server `413` errors have the same explanation. No backend limits changed.

Saving disables the form and duplicate submissions, and success is displayed
only after a valid backend response. All save failures keep the entered draft.
For an uncertain network outcome, use Check saved version before retrying; writes
are never automatically retried. Validation focuses the relevant field, while
server errors use a focused alert.

A `409` conflict blocks saving against the stale version. Check saved version
fetches the latest profile without replacing the draft. The owner can expand
Latest saved profile to review it, then explicitly choose Load saved version.
The old draft remains in an owner-only, expandable reference on the same page so
the owner can copy wanted edits into the latest version. There is no automatic
merge, revision replacement, or overwrite. Any later concurrent change produces
another conflict. Previous-draft references are not persisted to browser storage.

Sign out / All devices is available on desktop and mobile. It uses the existing
`POST /user/logout` endpoint. If there are unsaved edits, an inline choice lets
the owner keep editing or sign out and discard that draft. A confirmed `204`
clears the UI and reports global sign-out. A failed logout keeps the profile open
and reports that global sign-out could not be confirmed. An already-invalid
session returns to login without claiming all other sessions were revoked.

The frontend clears the profile, conflict references, and token when its local
login lifetime ends, a profile request returns `401`, or logout succeeds. Another
device's logout is enforced by the backend on the next protected request; it
cannot recall information already loaded on a screen. Reloading still requires
login and clears unsaved data. While editing, the browser warns before leaving
or refreshing where the browser supports that warning. No medical information,
draft, or JWT is stored in localStorage, sessionStorage, or cookies.

Profile review files:

| File | Purpose |
| --- | --- |
| `frontend/src/pages/Profile.jsx` | Loading, create/edit flow, safe saves, conflict review, sharing summary |
| `frontend/src/profileForm.js` | Defaults, validation, UTC age, response validation, explicit create/update data |
| `frontend/src/components/SharingToggle.jsx` | Keyboard-accessible category switches with text and icons |
| `frontend/src/components/MedicalList.jsx` | Medical entry editing and 30-entry limits |
| `frontend/src/components/EmergencyContacts.jsx` | Optional contacts, required per-contact fields, five-contact limit |
| `frontend/src/api.js` | Bearer profile/logout requests, status-aware safe errors, timeouts and size limit |
| `frontend/src/App.jsx` | Post-login profile, expiry, global logout and private-state cleanup |
| `frontend/test/profile.test.js` | Boundary validation, preservation/clearing, request allowlists and safe failures |

Manual review:

1. Sign up/log in with a test account. A new profile must be empty, private, and
   savable with only display name and DOB.
2. Add medical entries and a contact. Turn one category public, save, then log out
   and back in: values and consent must reload correctly.
3. Remove optional entries/contacts and clear blood type, then save. Other fields
   and sharing choices must stay intact. DOB must never have a public control.
4. Open a second logged-in tab, change/save the profile, then try saving an older
   draft in the first tab. Expect a conflict and preserved draft, followed by
   explicit saved-version review and load. Neither version should be silently lost.
5. Sign out and confirm another session for that account loses API access. Failed
   requests must not claim success. Session expiry must return to login and remove
   the private profile from the page.
6. Check keyboard navigation and phone widths. All fields, sharing controls,
   add/remove buttons, and sign-out must remain usable.

No new packages, backend endpoints, database collections, or schema changes were
needed for this frontend step. QR management and the public visitor page remain
future frontend work.

### QR management frontend

After signing in, choose **Your QR** (`#/qr`). The page follows the Profile page's
rounded-card design and uses the existing authenticated QR endpoints. No new
backend endpoints or database fields are required.

- The preview comes from `GET /user/profile/public-preview`, never the owner's
  unsaved form. Private categories, DOB and empty lists are omitted.
- At least one saved, non-empty public field/category is needed for generation
  or activation. Blood type and emergency contacts remain optional.
- Generate a pending QR, download the PNG, then explicitly confirm it was saved
  before activation. Downloading does not automatically check the confirmation.
- QR images are generated locally using `qrcode`; no external QR service receives
  the link. The image has black modules, a white background and a four-module margin.
- The original QR link and image stay only in React memory during the signed-in
  session, including switches between Profile and Your QR. Refreshing the browser,
  signing out or session expiry clears them. Nothing is saved to browser storage.
- If a pending QR exists without its original link, an owner who already saved
  its PNG can confirm they still have that copy and activate the same pending QR.
  If the PNG is lost, discard the pending QR before generating another.
  Discarding a replacement preserves the current active QR.
- Activating a replacement disables the previous QR in the existing backend
  transaction. Revocation requires confirmation and preserves the saved profile.
- After an uncertain response, changes are blocked until QR status is refreshed.
  Loading failures are distinct from an empty public profile. A 401 clears the
  signed-in views and returns to login.
- Profile drafts remain in memory while switching to Your QR, but do not affect
  its saved public preview. Sign-out warns about drafts or an unconfirmed QR copy.

Main implementation: `frontend/src/pages/QrManagement.jsx`,
`frontend/src/components/PublicPreview.jsx`, `frontend/src/qrApi.js`; navigation
is in `App.jsx` and `AuthLayout.jsx`. Focused API/privacy tests are in
`frontend/test/qr.test.js`.

The public visitor page now opens at `/e/:token`. `PUBLIC_BASE_URL` controls
issued links. A localhost/127.0.0.1 link works only on the same computer; scanning
from a phone requires a reachable deployment/address. Configure that origin
before generating links intended for other devices, and never expose the local
MongoDB instance to make a QR reachable.

### Public emergency page

Run `npm run build:frontend` after frontend changes. Restart the backend if its
code changed. Browser navigation to an existing backend `/e/:token` link serves
the built frontend shell and its local assets; the shell contains no token or
medical data. A missing frontend build returns a safe 503. The owner development
frontend remains available through `npm run dev:frontend` on port 5173.

The public page requests the same `/e/:token` path with `Accept: application/json`.
JSON clients retain the existing response/status behavior, including generic 404
for unavailable profiles. HTML document requests serve the app shell with 200;
the subsequent JSON response decides whether the page displays a profile or an
unavailable/error state. HTML and JSON responses include `Vary: Accept`, no-store,
no-referrer and noindex headers. Vite also supports public document navigation
and proxies public JSON requests to the backend during development/preview.

- Public rendering is selected before mounting the signed-in application: no
  login, JWT, owner/profile API request, or account navigation is required.
- `PublicEmergency.jsx` displays only validated fields from the public response.
  The owner preview and public page share `publicProfile.js` validation. DOB,
  unknown/private categories and malformed contact phone values fail closed.
- Missing/empty sections are omitted. Age zero is valid, and an age-only profile
  does not list the fields the owner withheld. Medical entries remain plain text.
- Contacts appear above medical sections on mobile with explicit `tel:` links.
  Opening the page never initiates a call. No location is collected and no
  country-specific emergency phone number is assumed.
- Unavailable links, temporary failures and rate limits have separate screens.
  Retry waits for a valid server-provided Retry-After delay when present. There
  is no automatic retry loop or invented countdown.
- Data lives only in component memory. Every request uses no-store and omits
  cookies/authorization. Hidden/page-leave events clear displayed data and abort
  pending reads; returning to the page fetches current information again.
- No third-party fonts, analytics, images, embeds, verification claims, or
  automatic medical classifications are added. The document title is generic.

Tests: `frontend/test/publicEmergency.test.js` covers response validation and
safe requests; `test/publicFrontend.test.js` covers HTML/JSON routing and privacy
headers. The existing public endpoint integration suite covers consent and QR
revocation against MongoDB.

### Additional information

Profiles support an optional `additionalInformation` string (up to 1,000 UTF-16
code units, matching the browser character counter). Line breaks and tabs are
allowed; other control characters are rejected. It is encrypted with the other
profile contents and private by default. Set
`sharingConsent.additionalInformation` explicitly to share it. Empty text is never
included in a public response, even when its sharing choice is public.

Use the existing profile POST/PATCH routes; PATCH omission preserves the value,
and `additionalInformation: ""` clears it. Profiles saved before this field existed
read as empty and private without a database migration. Saved sharing changes
apply to existing active QR links.

### QR sticker downloads

Newly issued QR links can be downloaded in red/white, white/red, or yellow/navy
sticker styles. Select one, two, or all three; every design encodes the same link.
Light, charcoal, and coral surfaces are previews only and are not exported.
Downloads are 1800 × 760 PNGs. No print-size or scanning-performance guarantee is
implied: print a sample at the intended size and test it before use. Keep the
white QR margin intact. Use opaque printing material.

Browsers may block multiple downloads; individual PNG links remain available.
Activation requires a download request for every selected design and the owner's
explicit saved-copy confirmation. A request is not proof of a completed download.
Changing selection or refreshing QR status resets confirmation. Existing pending
QR recovery still works when the original link has left browser memory and the
owner already has a saved PNG. Designs cannot be recreated from the database:
only the token digest is stored. Activation/replacement/revocation affects every
sticker for that credential together. Sticker generation uses the existing QR
package and browser canvas; no additional runtime dependencies were added.

## Staging preparation — synthetic data only

No staging service has been deployed yet. The planned setup is one Render Web
Service and a dedicated MongoDB Atlas staging database with transaction support.
Do not publish local .env values or copy local
application records. Staging must use its own JWT secret and profile encryption
key. The application requires NODE_ENV=production and an HTTPS PUBLIC_BASE_URL
when deployed. Express now serves the React application at `/` for browser
navigation, including `/#/login`, `/#/signup`, `/#/profile`, and `/#/qr`.
The existing `/e/:token` browser/JSON behavior is preserved. API requests go
directly to `/user/...`; unknown routes and missing assets remain 404 rather than
returning the React page. Production startup refuses to start without a readable
`frontend/dist/index.html`. Local development can still run before a build.

### Render settings (after code review and GitHub push)

| Setting | Value |
| --- | --- |
| Root directory | Leave empty |
| Runtime | Node, version pinned by `.node-version` |
| Build command | `npm ci && npm --prefix frontend ci --include=dev && npm run build` |
| Start command | `npm start` |
| Instance | Free, for synthetic staging tests |

The explicit `--include=dev` keeps Vite and Tailwind available during the build
even with `NODE_ENV=production`. Lockfiles control dependency versions. No new
runtime package is required. Let Render provide `PORT`; the HTTP server listens
on the available interfaces and uses that port.

Set these values privately in Render, never in frontend variables or Git:

| Variable | Staging value |
| --- | --- |
| `NODE_ENV` | `production` |
| `dbconnection` | Atlas URI explicitly targeting `emergency_qr_staging` |
| `JWT_SECRET` | A fresh staging-only random secret, at least 32 bytes |
| `PROFILE_ENCRYPTION_KEY` | A separate fresh 32-byte key encoded as 64 hex characters |
| `PUBLIC_BASE_URL` | The real HTTPS staging origin used in QR links |
| `TRUST_PROXY_HOPS` | `1` for the planned immediate trusted Render proxy; verify forwarding during staging |

`TRUST_PROXY_HOPS` defaults to `0` locally and accepts only `0` or `1`. With `1`,
Express reads the rightmost forwarded client address and ignores earlier values.
Never enable it on a server directly reachable without that trusted proxy. Before
opening staging for tests, verify Render supplies that address and that separate
visitors receive separate rate-limit buckets; a configured hop count is not proof
of the hosted forwarding behavior. Do not set `trust proxy` to unrestricted `true`.
See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/),
[Render web services](https://render.com/docs/web-services), and
[Render Node versions](https://render.com/docs/node-version).

Review locally using the built website directly at `http://127.0.0.1:3000/` after
`npm run build` and `npm start` (with your local database running). Vite is not
needed for this review. Keep `TRUST_PROXY_HOPS=0` locally. A real production-mode
startup also requires an HTTPS `PUBLIC_BASE_URL`; it can be tested with a disposable
database and synthetic secrets without editing the local `.env`.

Atlas access, custom-domain DNS, hosted rate limits, and a scan from a phone still
need verification after deployment. Changing `PUBLIC_BASE_URL` affects newly
issued links; it does not rewrite previously downloaded QR stickers.

A provider-neutral seed command is ready. It does not read the root .env. Supply
STAGING_MONGODB_URI, STAGING_PROFILE_ENCRYPTION_KEY, and STAGING_SEED_PASSWORD through
private environment settings, then run npm run staging:seed once. The URI must
explicitly target the database emergency_qr_staging. It requires an empty database
and transaction support, refuses existing records, and never deletes or resets
collections. Run it only once against the dedicated staging database without
concurrent traffic. PROFILE_ENCRYPTION_KEY on the staging server must match
STAGING_PROFILE_ENCRYPTION_KEY used for seeding. Use a unique seed password meeting
the signup requirements; neither the password nor keys are printed.

Accounts: demo.owner@example.test (fictional shared categories) and
demo.private@example.test (all private). They contain no real contact numbers or
medical records. Sign in with the private seed password, then generate/download
and activate QR stickers through the normal UI. The seeder does not store raw QR
tokens, create sessions, or bypass QR activation. Example.test addresses do not
receive mail. Keep access to the staging owner accounts controlled.
