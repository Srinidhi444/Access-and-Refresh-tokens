# JWT Auth Demo — Access Tokens + Rotating Refresh Tokens

A production-style authentication system demonstrating the **canonical JWT architecture**: short-lived RS256 access tokens held in browser memory, paired with long-lived, server-tracked, rotating refresh tokens stored in an `HttpOnly` cookie. Includes refresh-token reuse detection, session revocation, and a live token-lifecycle dashboard.

```txt
React (Vite) ── Access token in memory ──▶ Express API ── RS256 verify (no DB hit)
      │                                          │
      └── Refresh token: HttpOnly cookie ────────┴── MongoDB (refresh-token sessions)
```

---

## Table of Contents

1. [Stack](#stack)
2. [Repo Structure](#repo-structure)
3. [Setup](#setup)
4. [Environment Variables](#environment-variables)
5. [Running the App](#running-the-app)
6. [API Reference](#api-reference)
7. [Token Architecture](#token-architecture)
8. [Why RS256](#why-rs256)
9. [Refresh Token Rotation](#refresh-token-rotation)
10. [Reuse Detection](#reuse-detection)
11. [Login / Logout Flows](#login--logout-flows)
12. [Handling Stale & Expired Sessions](#handling-stale--expired-sessions)
13. [Attack Scenarios & Mitigations](#attack-scenarios--mitigations)
14. [Dashboard Token Lifecycle View](#dashboard-token-lifecycle-view)
15. [Known Limitations / Production TODOs](#known-limitations--production-todos)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), React Router, Axios |
| Backend | Node.js, Express |
| Database | MongoDB (Mongoose) |
| Access token | JWT, RS256 (asymmetric signing) |
| Refresh token | Opaque random token, SHA-256 hashed at rest, rotated on use |
| Password hashing | bcrypt |
| Styling | Plain CSS — black & white, glassmorphism |

---

## Repo Structure

```txt
jwt-refresh-demo/
├── server/
│   ├── package.json
│   ├── generate-keys.js
│   ├── .env
│   ├── keys/
│   │   ├── private.pem
│   │   └── public.pem
│   └── src/
│       ├── server.js
│       ├── app.js
│       ├── config/
│       │   └── db.js
│       ├── models/
│       │   ├── User.model.js
│       │   └── RefreshToken.model.js
│       ├── services/
│       │   └── tokenService.js
│       ├── middleware/
│       │   └── auth.middleware.js
│       └── routes/
│           ├── auth.routes.js
│           └── protected.routes.js
└── client/
    ├── package.json
    ├── .env
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── api/
        │   └── axios.js
        ├── context/
        │   └── AuthContext.jsx
        ├── utils/
        │   └── jwt.js
        └── pages/
            ├── Signin.jsx
            ├── Signup.jsx
            └── Dashboard.jsx
```

---

## Setup

### Prerequisites

- Node.js 18+
- A running MongoDB instance (local or Atlas)

### 1. Clone and install backend

```bash
cd server
npm install
```

### 2. Generate the RS256 keypair

Access tokens are signed with a private key and verified with a public key. Generate this pair once — it must exist before the server starts.

```bash
node generate-keys.js
```

This creates `keys/private.pem` and `keys/public.pem`. Never commit these to version control in a real project.

### 3. Install frontend

```bash
cd ../client
npm install
```

---

## Environment Variables

### `server/.env`

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/jwt_demo
NODE_ENV=development
```

### `client/.env`

```env
VITE_API_URL=http://localhost:5000/api
```

---

## Running the App

Terminal 1 — backend:

```bash
cd server
npm run dev
```

Terminal 2 — frontend:

```bash
cd client
npm run dev
```

Open `http://localhost:5173`. The backend must allow credentialed CORS from this origin:

```js
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
```

---

## API Reference

| Method | Route | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | No | Create account, issue access + refresh token |
| POST | `/api/auth/signin` | No | Authenticate, issue access + refresh token |
| POST | `/api/auth/refresh` | Refresh cookie | Rotate refresh token, issue new access token |
| GET | `/api/auth/session-info` | Refresh cookie | Return refresh-session metadata (no raw token) |
| POST | `/api/auth/logout` | Refresh cookie | Revoke current session family |
| POST | `/api/auth/logout-all` | Access token | Revoke every session for the user |
| GET | `/api/me` | Access token | Example protected resource |

---

## Token Architecture

Two credentials, two jobs, two storage locations:

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (RS256) | Opaque random string |
| Lifetime | 10 minutes | 30 days |
| Client storage | JavaScript memory only | `HttpOnly`, `Secure`, `SameSite=Strict` cookie |
| Server storage | None (stateless, self-verifying) | SHA-256 hash in MongoDB |
| Readable by JS? | Yes, briefly, while in memory | Never |
| Revocable? | No — just wait out the short expiry | Yes — delete/flag its DB record |
| Sent on | Every API request (`Authorization: Bearer`) | Only to `/api/auth/*` (cookie `path` scoped) |

**Why split them this way:** if an XSS attack manages to read the access token, the blast radius is capped at ~10 minutes. The refresh token — the credential that matters over the long term — never enters JS-reachable memory at all, because the browser handles `HttpOnly` cookies without exposing them to `document.cookie` or any script.

---

## Why RS256

RS256 signs the JWT with a **private key** and verifies it with a matching **public key** — as opposed to HS256, which uses one shared secret for both operations.

```txt
Backend (private.pem) ── signs access tokens
Any verifier (public.pem) ── checks signatures, cannot create tokens
```

**What it prevents:** an attacker cannot forge or modify a token's claims (e.g. changing `sub` to another user's ID) without the private key — any tampering breaks the signature and `jwt.verify` rejects it.

**What it does NOT do:** RS256 doesn't encrypt the payload. A JWT is signed, not encrypted — anyone can base64-decode and read the claims. It also doesn't revoke tokens; a valid, unexpired token remains valid regardless of what happens server-side. That's precisely why the access token's lifetime is kept short — 10 minutes is the outer bound of how "wrong" an already-issued token can be.

Verification also pins the algorithm explicitly:

```js
jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
```

This blocks classic JWT algorithm-confusion attacks (e.g. an attacker sending a token signed with `alg: none` or switching to HS256 using the public key as an HMAC secret).

---

## Refresh Token Rotation

Every time a refresh token is used, it's replaced — it cannot be used twice.

```txt
Login
  └─ Token A (familyId: F1)

Refresh
  └─ Token A → revoked
  └─ Token B created (familyId: F1)

Refresh
  └─ Token B → revoked
  └─ Token C created (familyId: F1)
```

All tokens produced from one login form a **family** (`familyId`). Rotation happens inside `/api/auth/refresh`:

```txt
1. Hash the presented raw token.
2. Look it up in MongoDB.
3. Not found          → reject (401 INVALID_TOKEN)
4. Expired            → reject (401 EXPIRED_TOKEN)
5. Already revoked    → REUSE DETECTED (see below)
6. Otherwise: revoke it, create a new token in the same family, return it.
```

This caps how long a stolen refresh token is useful: it either gets used immediately (before the legitimate client rotates it) or it becomes worthless the moment either party rotates first.

---

## Reuse Detection

Rotation alone tells you a token was single-use. **Reuse detection** is what turns that into an actual theft alarm.

```txt
Legit browser:  Token A → rotates → Token B
Attacker:       replays Token A (already revoked)
                        │
                        ▼
        Server sees revokedAt != null on Token A
                        │
                        ▼
        Revoke EVERY token in familyId F1
                        │
                        ▼
        Both the attacker and the legit browser
        are logged out — user must sign in again
```

This is a deliberate trade-off: a genuine theft attempt should force full re-authentication rather than silently continuing, even though it also logs out the legitimate user in that moment. It's the same logic OAuth/OIDC providers use for refresh token rotation.

---

## Login / Logout Flows

### Signup / Signin

```txt
1. Validate input, hash password with bcrypt (signup only).
2. Verify credentials (signin only).
3. Sign a new RS256 access token.
4. Create a brand-new refresh-token family, store its hash in MongoDB.
5. Set the refresh token as an HttpOnly cookie, scoped to /api/auth.
6. Return the access token in the JSON response body.
7. Client stores the access token in memory; user state is set.
```

### Authenticated request

```txt
1. Axios attaches Authorization: Bearer <access-token>.
2. Middleware verifies signature + expiry (RS256, public key). No DB call.
3. Valid → req.user populated, request proceeds.
4. Invalid/expired → 401.
```

### Access token expires mid-session

```txt
1. Request returns 401.
2. Axios interceptor detects this (and that it isn't already a retry
   or an auth endpoint), then calls POST /api/auth/refresh.
3. Browser auto-attaches the refresh cookie (JS never touches it).
4. Server rotates the refresh token, issues a new access token.
5. Interceptor retries the original request with the new token.
6. User never notices — the request just "worked."
```

### Page reload

```txt
1. In-memory access token is gone (memory doesn't survive a reload).
2. AuthContext calls /api/auth/refresh on mount.
3. If the refresh cookie is still valid → new access token, session restored.
4. If not → user lands on /signin.
```

### Logout

```txt
1. POST /api/auth/logout.
2. Server finds the current refresh token's family, revokes it entirely.
3. Server clears the cookie.
4. Client clears the in-memory access token and user state.
```

### Logout everywhere

```txt
1. POST /api/auth/logout-all (requires a valid access token).
2. Server revokes every non-revoked refresh token belonging to that user,
   across all families/devices.
3. Every other open session loses its ability to refresh.
```

---

## Handling Stale & Expired Sessions

"Stale" sessions can mean a few different things in this system — each is handled differently on purpose.

### 1. Access token merely expired (the common case)

This is expected, routine behavior — it happens every ~10 minutes for an active user. It does **not** revoke anything. The interceptor silently refreshes and the family stays intact:

```txt
Expired access token → 401 → auto-refresh → new access token → retry
```

### 2. Refresh token expired (user inactive for 30+ days)

```txt
POST /api/auth/refresh
        │
        ▼
existing.expiresAt < now()
        │
        ▼
401 EXPIRED_TOKEN, cookie cleared
        │
        ▼
Client redirects to /signin
```

No family revocation is needed — an expired token can't be used again anyway. MongoDB's TTL index (`expireAfterSeconds: 0` on `expiresAt`) also physically deletes these documents automatically, keeping the collection clean without a cron job.

### 3. Refresh token missing entirely

Happens when cookies were cleared, the user is on a new device, or it's a fresh browser profile:

```txt
No refresh_token cookie
        │
        ▼
401 NO_REFRESH_TOKEN
        │
        ▼
Client redirects to /signin
```

### 4. Refresh token reused after rotation (theft signal)

Covered in detail above — this is the one case that **does** revoke the entire family, because it's the one case that indicates something is actually wrong rather than just "time passed."

### 5. Concurrent requests during expiry

If five API calls fail with 401 simultaneously (e.g. a dashboard loading multiple widgets at once), the client doesn't fire five separate `/refresh` calls — which would be a real problem given that refresh tokens are single-use. Instead:

```js
if (!refreshPromise) {
  refreshPromise = api.post('/auth/refresh')...
}
const newToken = await refreshPromise; // everyone awaits the same promise
```

All five requests await the *same* in-flight refresh promise, then retry with the resulting token. Only one rotation happens.

### 6. React StrictMode double-invocation

In development, React 18 StrictMode intentionally runs mount effects twice to surface bugs. Without a guard, this would fire two `/refresh` calls on load — the second would see an already-rotated (and thus already-revoked) token and trip reuse detection, incorrectly logging the user out. Fixed with a `useRef` guard so session restoration runs exactly once:

```js
const hasInitialized = useRef(false);
useEffect(() => {
  if (hasInitialized.current) return;
  hasInitialized.current = true;
  restoreSession();
}, []);
```

---

## Attack Scenarios & Mitigations

| Scenario | Mitigation in this system |
|---|---|
| XSS reads `localStorage` | Access token is never in `localStorage`; it lives only in JS memory and expires in 10 min |
| XSS tries to read the refresh token | Impossible — `HttpOnly` blocks all script access to the cookie |
| Attacker steals a refresh token (e.g. via device/log access) and replays it | First use by either party rotates the token; if the stolen one is used *after* rotation, reuse detection revokes the whole family |
| Attacker forges/modifies a JWT's claims | RS256 signature check fails without the private key |
| Attacker sends a token with `alg: none` or switches algorithms | `jwt.verify` is pinned to `algorithms: ['RS256']` |
| Refresh cookie sent cross-site (CSRF) | `SameSite=Strict` + cookie `path` scoped to `/api/auth` only |
| Database read exposure (backup leak, etc.) | Only SHA-256 hashes of refresh tokens are stored, never raw values — same principle as password hashing |
| User loses their device | `logout-all` revokes every refresh-token family for that user, killing all sessions everywhere |
| Long-idle session | Refresh token has a hard 30-day expiry; MongoDB TTL index purges expired records automatically |

**What this system does NOT solve by itself:** rate limiting on auth endpoints, CSRF tokens beyond `SameSite`, HTTPS enforcement, secrets-manager key storage, and general XSS hardening (CSP, output encoding) are all still the app's responsibility — see below.

---

## Dashboard Token Lifecycle View

After signing in, the dashboard shows the tokens' actual lifecycle instead of static text:

```txt
Access Token card          Refresh Token card
├─ Masked token preview    ├─ Session family ID (masked)
├─ Status: Active/         ├─ Status: Active/Expired
│  Expiring/Expired        ├─ Days/hours remaining
├─ Countdown (mm:ss)       └─ Issued timestamp
└─ Draining progress bar

Event Timeline
├─ "Signed in — access token issued, refresh session started"
├─ "Access token expiring in under 60 seconds"
├─ "Access token expired — refresh token rotated, new access token issued"
├─ "Manual refresh — refresh token rotated"
└─ "Logged out — refresh token family revoked"
```

A "Force refresh" button triggers rotation on demand, so the whole expiry → refresh → rotate cycle can be observed without waiting the full 10 minutes.

---

## Known Limitations / Production TODOs

- **Atomic rotation**: the current find-then-revoke-then-create sequence isn't wrapped in a MongoDB transaction. Under true concurrent refresh calls, use `findOneAndUpdate` with a conditional filter or a transaction to guarantee a token is consumed exactly once.
- **Rate limiting**: `/signup`, `/signin`, and `/refresh` have no throttling yet — add `express-rate-limit` or similar before exposing this publicly.
- **CSRF tokens**: `SameSite=Strict` covers most cases, but a double-submit CSRF token on `/refresh` and `/logout` adds defense in depth.
- **Secrets management**: `private.pem` is a local file for this demo. In production, load it from a secrets manager (AWS Secrets Manager, Vault, etc.), never from the repo.
- **HTTPS**: `secure: true` on cookies is gated behind `NODE_ENV === 'production'` — make sure the production deployment actually terminates TLS before that cookie flag matters.
- **Security headers**: add `helmet` and a Content-Security-Policy to reduce the impact of any future XSS vector.
- **Session management UI**: the data model already supports listing/revoking individual sessions (`createdByIp`, `userAgent`, `familyId` per record) — a "your devices" page is a natural next feature.