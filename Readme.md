# JWT Auth Demo — Access Tokens + Rotating Refresh Tokens

A production-style authentication demo using short-lived RS256 access tokens in browser memory and long-lived, server-tracked, rotating refresh tokens in an `HttpOnly` cookie. It includes refresh-token reuse detection, session revocation, automatic refresh, and a live token-lifecycle dashboard.

```txt
React ── access token in memory ──▶ Express API ── RS256 verification
  │                                      │
  └── refresh token: HttpOnly cookie ───┴── MongoDB refresh sessions
```

## Table of Contents

1. [Stack](#stack)
2. [Repository Structure](#repository-structure)
3. [Setup](#setup)
4. [Environment Variables](#environment-variables)
5. [Running the App](#running-the-app)
6. [API Reference](#api-reference)
7. [Token Architecture](#token-architecture)
8. [Why RS256](#why-rs256)
9. [Refresh Rotation and Reuse Detection](#refresh-rotation-and-reuse-detection)
10. [Authentication Flows](#authentication-flows)
11. [Stale and Expired Sessions](#stale-and-expired-sessions)
12. [Attack Scenarios and Mitigations](#attack-scenarios-and-mitigations)
13. [Dashboard Lifecycle View](#dashboard-lifecycle-view)
14. [Token Architecture Limitations](#token-architecture-limitations)

## Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), React Router, Axios |
| Backend | Node.js, Express |
| Database | MongoDB with Mongoose |
| Access token | JWT with RS256 asymmetric signing |
| Refresh token | Opaque random token, SHA-256 hash at rest, rotated on use |
| Password hashing | bcrypt |
| Styling | Plain CSS, black-and-white glassmorphism |

## Repository Structure

```txt
jwt-refresh-demo/
├── backend/
│   ├── package.json
│   ├── generate-keys.js
│   ├── .env
│   ├── keys/{private.pem,public.pem}
│   └── src/
│       ├── server.js
│       ├── app.js
│       ├── config/db.js
│       ├── models/{User.model.js,RefreshToken.model.js}
│       ├── services/tokenService.js
│       ├── middleware/auth.middleware.js
│       └── routes/{auth.routes.js,protected.routes.js}
└── client/
    ├── package.json
    ├── .env
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── api/axios.js
        ├── context/AuthContext.jsx
        ├── utils/jwt.js
        └── pages/{Signin.jsx,Signup.jsx,Dashboard.jsx}
```

## Setup

### Prerequisites

- Node.js 18 or later.
- A running MongoDB instance, local or Atlas.

### Install the backend

```bash
cd backend
npm install
```

### Generate the RS256 keypair

```bash
node generate-keys.js
```

This creates `keys/private.pem` and `keys/public.pem`. Never commit the private key in a real project.

### Install the frontend

```bash
cd ../client
npm install
```

## Environment Variables

### `backend/.env`

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/jwt_demo
NODE_ENV=development
```

### `client/.env`

```env
VITE_API_URL=http://localhost:5000/api
```

## Running the App

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd client
npm run dev
```

Open `http://localhost:5173`. The backend must allow credentialed CORS:

```js
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
```

## API Reference

| Method | Route | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | None | Create a user and issue tokens |
| POST | `/api/auth/signin` | None | Authenticate and issue tokens |
| POST | `/api/auth/refresh` | Refresh cookie | Rotate refresh token and issue access token |
| GET | `/api/auth/session-info` | Refresh cookie | Return safe refresh-session metadata |
| POST | `/api/auth/logout` | Refresh cookie | Revoke the current session family |
| POST | `/api/auth/logout-all` | Access token | Revoke every session for the user |
| GET | `/api/me` | Access token | Example protected resource |

## Token Architecture

The system uses two credentials with different purposes and storage locations:

| | Access token | Refresh token |
|---|---|---|
| Format | RS256 JWT | Opaque random string |
| Lifetime | 10 minutes | 30 days |
| Client storage | JavaScript memory only | `HttpOnly`, `Secure`, `SameSite=Strict` cookie |
| Server storage | None; verified using signature | SHA-256 hash in MongoDB |
| Readable by JavaScript? | Yes, while in memory | No |
| Revocable? | Not immediately; expires naturally | Yes, through MongoDB state |
| Used for | Every protected API request | Only token refresh operations |

The short-lived access token limits the impact of a stolen access token. The long-lived refresh token never enters JavaScript-accessible storage.

## Why RS256

RS256 uses asymmetric signing:

```txt
Private key → signs access tokens
Public key  → verifies access tokens
```

The private key stays on the authentication server. Other services can verify tokens with the public key without being able to create new ones. This is useful when an application later grows into multiple services.

RS256 prevents attackers from modifying claims or forging valid tokens without the private key. It does not encrypt the JWT payload, revoke issued tokens, or prevent the use of a valid stolen token. The payload should contain only non-sensitive claims such as `sub`, `email`, `iat`, and `exp`.

Verification pins the algorithm:

```js
jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
```

## Refresh Rotation and Reuse Detection

A successful refresh always replaces the refresh token:

```txt
Signin:
  Access A + Refresh A, family F1

Refresh:
  Refresh A → revoked
  Refresh B → created, family F1
  Access B  → created

Next refresh:
  Refresh B → revoked
  Refresh C → created, family F1
  Access C  → created
```

The server stores only the SHA-256 hash of each refresh token. Each record contains the user, `familyId`, expiry, revocation state, replacement hash, IP, and user-agent metadata.

The refresh process is:

```txt
1. Hash the presented refresh token.
2. Find its record in MongoDB.
3. Missing  → 401 INVALID_TOKEN.
4. Expired  → 401 EXPIRED_TOKEN.
5. Already revoked → reuse detected.
6. Valid → revoke old token, create replacement, issue access token.
```

If a previously revoked token is presented again, the server treats it as possible theft and revokes all active tokens in that family. The legitimate user must sign in again.

## Authentication Flows

### Signup and signin

```txt
1. Validate input.
2. Hash the password with bcrypt during signup or verify it during signin.
3. Create an RS256 access token.
4. Create a refresh-token family and store its hash.
5. Set the refresh token as an HttpOnly cookie scoped to /api/auth.
6. Return the access token in JSON.
7. Store the access token in React memory.
```

### Normal protected request

```txt
1. Axios sends Authorization: Bearer <access-token>.
2. Express verifies the signature and expiry using the public key.
3. Valid token → req.user is populated and the route proceeds.
4. Invalid or expired token → 401.
```

Normal API requests do not rotate the refresh token and do not require a MongoDB lookup.

### Expired access token

```txt
Protected request → 401
  → Axios calls /api/auth/refresh
  → Browser sends HttpOnly refresh cookie
  → Server rotates refresh token
  → New access token returned
  → Original request retried
```

A shared `refreshPromise` prevents several simultaneous failed requests in one tab from performing multiple rotations.

### Page reload

The access token disappears because it is stored in memory. `AuthContext` automatically calls `/api/auth/refresh` during startup. If the cookie is valid, the session is restored and a new access token is stored in memory.

### Logout

```txt
POST /api/auth/logout
  → Revoke the current refresh-token family
  → Clear the refresh cookie
  → Clear the in-memory access token and user state
```

The existing access token may technically remain valid until its short expiry, but it cannot be refreshed.

### Logout everywhere

```txt
POST /api/auth/logout-all
  → Revoke all refresh sessions belonging to the user
  → Other devices can no longer refresh
  → Their existing access tokens expire naturally
```

## Stale and Expired Sessions

### Expired access token

This is normal. It does not revoke the refresh family:

```txt
Expired access token → 401 → refresh → new access token → retry
```

### Expired refresh token

A user inactive for more than the 30-day refresh lifetime receives `401 EXPIRED_TOKEN`, the cookie is cleared, and signin is required. MongoDB's TTL index removes expired records automatically.

### Missing refresh token

A cleared cookie, new browser, or new device produces `401 NO_REFRESH_TOKEN`; the client requires signin.

### Reused refresh token

A previously rotated refresh token produces reuse detection and revokes its entire family. This is the only normal refresh condition that triggers family-wide revocation.

### React StrictMode

Development StrictMode can invoke mount effects twice. The `useRef` initialization guard ensures session restoration runs once and avoids accidental double rotation during startup.

## Attack Scenarios and Mitigations

| Scenario | Mitigation |
|---|---|
| XSS reads `localStorage` | Access tokens are never stored there; they live only in memory and expire quickly |
| Script reads refresh token | `HttpOnly` prevents JavaScript from reading the cookie |
| Stolen refresh token is replayed | Rotation makes tokens single-use; reuse detection revokes the family |
| JWT claims are modified or forged | RS256 signature verification rejects tampered tokens |
| Algorithm confusion attempt | Verification accepts only `RS256` |
| Cross-site cookie abuse | `SameSite=Strict` and the cookie path is limited to `/api/auth` |
| Database read exposure | Only refresh-token hashes are stored |
| Lost device | `logout-all` revokes all refresh-token families |
| Long-idle session | Refresh token expires after 30 days and MongoDB purges it |

`HttpOnly` prevents refresh-token reading, but it does not make XSS harmless: malicious same-site JavaScript may still attempt requests as the user. Cookie-based authentication must therefore be combined with CSRF and XSS defenses.

## Dashboard Lifecycle View

The dashboard displays a live, safe view of the session without exposing the raw refresh token:

```txt
Access-token card
├── Masked access-token preview
├── Active / Expiring / Expired status
├── Countdown and progress bar
└── Issued time and storage information

Refresh-session card
├── Masked session family ID
├── Active / Expired status
├── Remaining days and hours
└── Issued time and cookie information

Event timeline
├── Signin or signup
├── Session restoration
├── Token expiration warning
├── Automatic or manual rotation
└── Logout and family revocation
```

The **Force refresh** button calls `/api/auth/refresh` immediately so rotation can be observed without waiting ten minutes. It is a demonstration feature, not normally a user-facing production control.

## Token Architecture Limitations

### 1. Access tokens are not immediately revocable

The server does not store access tokens or query MongoDB for every request. After logout, an already-issued access token may remain valid until its short expiration time. Refresh-token revocation prevents new access tokens from being issued.

### 2. Access tokens disappear after reload

This is the security trade-off of memory-only storage. The refresh cookie restores the session during application startup.

### 3. XSS can still use an in-memory access token

An XSS payload may make API requests while the application is open. Memory-only storage reduces persistence but does not replace CSP, output encoding, safe dependencies, and general XSS prevention.

### 4. HttpOnly does not eliminate CSRF risk

Scripts cannot read an HttpOnly cookie, but the browser may attach it automatically to requests. `SameSite=Strict` helps, but cookie-based authentication still requires appropriate origin and CSRF protections.

### 5. Rotation must be atomic

The demo's rotation logic should use a MongoDB transaction, atomic conditional update, or distributed lock in production so two simultaneous requests cannot consume the same refresh token.

### 6. Multiple tabs need coordination

The Axios `refreshPromise` protects one tab. Multiple tabs can still race while rotating the same cookie. `BroadcastChannel`, browser locks, or a shared refresh coordinator can reduce this risk.

### 7. Reuse detection can log out the legitimate user

A reused token may indicate theft, but it may also result from a legitimate multi-tab race. Family-wide revocation is intentionally strict; atomic rotation and tab coordination reduce false positives.

### 8. A stolen refresh token is still dangerous

An attacker with the raw refresh token may use it before it is rotated. Rotation limits its lifetime of usefulness and reuse detection identifies later replay, but no token mechanism can make a successfully stolen credential harmless.

### 9. Refresh sessions have a maximum lifetime

After 30 days, the refresh session expires and the user must sign in again. This prevents indefinite sessions.

### 10. JWT payloads are readable

RS256 signs but does not encrypt the JWT. Never put passwords, secrets, payment data, or other sensitive information in the access-token payload.

### 11. Signing-key rotation requires planning

When RSA keys are replaced, old tokens must remain verifiable until they expire or the system must support key IDs and multiple active public keys during the transition.

### 12. Revocation applies immediately to refresh tokens, not access tokens

MongoDB can immediately prevent future refresh operations. Already-issued access tokens remain valid until expiry unless the application adds a separate denylist or server-side session check for sensitive operations.