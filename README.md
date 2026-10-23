# Emergency QR Code

A web application for creating an emergency profile and sharing selected information through a QR code. Visitors can scan an active QR without signing in. Only the information the owner chooses to make public is displayed.

## Features

- Signup and login with bcrypt passwords, JWTs, and server-side sessions.
- Logout from every device.
- One emergency profile per account; name and date of birth are required.
- Optional blood type, allergies, medical conditions, medications, additional information, and emergency contacts.
- Public/private sharing per category, private by default. Making a category public shares every entry in it.
- Date of birth stays private; age is calculated when public information is requested.
- One active QR and one pending replacement per profile.
- Three downloadable PNG sticker designs using the same QR link.
- Public emergency page with shared information, contact call buttons, and general citizen guidelines.

Profile contents are encrypted in MongoDB. QR tokens are stored as one-way digests.
Anyone with an active QR link can view its shared information. Owner-provided information is not medically verified.

## Technology

- **Frontend:** React, Vite, Tailwind CSS, and `qrcode`.
- **Backend:** Node.js, Express, Zod, bcrypt, and JSON Web Tokens.
- **Database:** MongoDB with Mongoose. QR changes require transactions, so use a replica set or suitable Atlas deployment.

## Project structure

| Path | Purpose |
| --- | --- |
| `backend/server.js` | Validate configuration, connect MongoDB, start HTTP, and shut down safely |
| `backend/app.js` | Create Express and mount routes without starting a server |
| `backend/routes/` | Account, profile, QR management, and public endpoints |
| `backend/models/` | Database schemas and indexes |
| `backend/validation/` | Request validation |
| `backend/security/` | Sessions, encrypted profiles, and QR lifecycle |
| `frontend/src/` | Pages, components, forms, and API requests |
| `test/`, `frontend/test/` | Backend and frontend tests |
| `scripts/` | Synthetic staging data and development utilities |

## Local setup

Use Node.js **24.22.1** (see `.node-version`) and MongoDB with transaction support.

### 1. Install dependencies

```sh
npm ci
npm --prefix frontend ci
cp .env.example .env
```

Copy the environment file only on first setup; keep an existing `.env`.

### 2. Configure the environment

| Variable | Purpose |
| --- | --- |
| `dbconnection` | MongoDB URI, including the database name |
| `PORT` | Backend port; defaults to `3000` |
| `NODE_ENV` | `development`, `test`, or `production` |
| `JWT_SECRET` | Random secret of at least 32 bytes |
| `PROFILE_ENCRYPTION_KEY` | Separate 32-byte key encoded as 64 hexadecimal characters |
| `PUBLIC_BASE_URL` | Website origin used in QR links; production requires HTTPS |
| `TRUST_PROXY_HOPS` | `0` locally; `1` only behind a verified trusted upstream proxy |

Generate each secret separately with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep secrets private and out of Git. Preserve the encryption key across restarts;
changing or losing it makes existing encrypted profiles unreadable.

For the project's local replica set, use:

```dotenv
dbconnection=mongodb://127.0.0.1:27018/emergency_qr?replicaSet=emergencyQrDev
PUBLIC_BASE_URL=http://localhost:3000
TRUST_PROXY_HOPS=0
```

### 3. Start MongoDB

For the existing local setup, run this in a separate terminal:

```sh
npm run db:start
```

This starts `mongod` on port `27018` using
`$HOME/.local/share/emergency-qr-mongo`. Keep the terminal open.

On a fresh machine, install MongoDB and `mongosh`, create that directory with
`mkdir -p "$HOME/.local/share/emergency-qr-mongo"`, and start the database.
Then initialize the replica set **once**, from another terminal:

```sh
mongosh --port 27018 --eval 'rs.initiate({_id:"emergencyQrDev",members:[{_id:0,host:"127.0.0.1:27018"}]})'
```

Alternatively, configure an accessible Atlas database. Starting the backend does
not start MongoDB. A standalone MongoDB instance cannot perform QR transactions.

### 4. Run the application

For frontend development, keep these commands running in separate terminals:

```sh
npm run dev
npm run dev:frontend
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).
Vite forwards `/user/...` requests to Express on port `3000`.

To review the built website through Express alone:

```sh
npm run build
npm start
```

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/).
Use one backend process at a time. A phone cannot open QR links pointing to
`localhost`; use an address reachable by that phone.

## API routes

Owner requests require `Authorization: Bearer <JWT>`. Send JSON for request bodies.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/user/signup` | Create an account |
| POST | `/user/login` | Sign in and create a session |
| POST | `/user/logout` | Invalidate all of the account's sessions |
| POST / GET / PATCH | `/user/profile` | Create, read, or update the owner's profile |
| GET | `/user/profile/public-preview` | Preview shared information |
| POST / GET | `/user/qr-credentials` | Issue a pending QR or list credentials |
| POST | `/user/qr-credentials/:id/activate` | Activate a pending QR and disable its predecessor |
| POST | `/user/qr-credentials/:id/revoke` | Disable a QR |
| GET | `/e/:token` | Public page for browsers; shared profile for JSON requests |

Signup requires first name, last name, email, and password. Passwords need at least
10 characters, one uppercase letter, one lowercase letter, and one special
character, with a maximum of 72 UTF-8 bytes. Login checks a nonempty password and
the byte limit without reapplying signup strength rules.

JWTs stay in page memory and expire after 15 minutes. Reloading requires signing
in again. QR download links also stay only in memory: save the PNG before leaving.
The database cannot recreate a download from the token digest. An existing saved
pending QR can still be activated after signing in again.

## Tests

```sh
npm test
npm run test:frontend
npm run build
```

`npm test` includes frontend and backend checks. Database integration tests require
`TEST_MONGODB_URI` pointing to a **separate disposable replica-set database**.
`TEST_STANDALONE_URI` enables the standalone-database failure test. Never use the
application or staging database for tests. Tests needing unset database URIs are skipped.

## Staging deployment

Planned setup: **one Render Web Service + MongoDB Atlas**, using synthetic data only.

| Render setting | Value |
| --- | --- |
| Root directory | Leave empty |
| Build command | `npm ci && npm --prefix frontend ci --include=dev && npm run build` |
| Start command | `npm start` |
| Node version | From `.node-version` |
| Environment | `NODE_ENV=production` |

Set the environment variables above privately in Render. Use a separate Atlas
database named `emergency_qr_staging`, fresh staging secrets, and an HTTPS
`PUBLIC_BASE_URL`. Let Render supply `PORT`. Verify trusted proxy forwarding and
rate limiting before opening staging for testing. Render Free can sleep after
inactivity and is intended here for testing, not live emergency reliance.

To seed fictional profiles, provide `STAGING_MONGODB_URI`,
`STAGING_PROFILE_ENCRYPTION_KEY`, and `STAGING_SEED_PASSWORD` privately, then run:

```sh
npm run staging:seed
```

The seeder requires an empty staging database with transaction support, refuses
existing records, and does not read the root `.env`. Its encryption key must match
the application's `PROFILE_ENCRYPTION_KEY`. It creates `demo.owner@example.test`
and `demo.private@example.test`; QR creation and activation use the normal UI.

Before deployment, review and push the intended code to GitHub. After deployment,
verify Atlas access, HTTPS, domain routing, rate limits, and phone scanning.
Changing domains does not update URLs already printed in QR stickers.

## Troubleshooting

- **Frontend connection refused:** check that the backend started on port `3000`.
- **Database startup error:** confirm MongoDB is running and the URI uses the correct port and replica-set name.
- **Port already in use:** stop the previous backend or select another port.
- **QR changes return 503:** confirm the database supports transactions.
- **Missing production frontend:** run `npm run build` before `npm start`.

Unknown routes return `404`; validation and server failures return safe errors.
The server waits for the database and indexes before accepting requests.
