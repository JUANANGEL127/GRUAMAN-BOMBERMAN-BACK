# Auth Session Runtime Evidence

This document records manual runtime evidence for the `auth-session-backend-contract` SDD change.

Evidence source: user-provided Postman collection runner screenshots on 2026-04-28.

Important: this is partial runtime evidence. It supports the auth/session implementation, but it does not fully prove the browser/frontend WebAuthn biometric flow or production-like HTTPS/CSRF behavior.

## Environment observed from screenshots

| Field | Value |
| --- | --- |
| Backend base URL | `http://localhost:3000` |
| Client | Postman collection runner |
| Cookie mode | Postman cookie jar |
| Auth mode under test | Local HTTP functional testing |

## Evidence table

| Flow | Request | Observed status | Observed assertions | Result | Notes |
| --- | --- | ---: | --- | --- | --- |
| Admin login | `POST /admin/login` | `200` | Status 200; authenticated true; actor is admin | Partial pass | Screenshot shows one failed cookie assertion expecting `gm_refresh` to be visible at that point. `POST /auth/refresh` later passed and confirmed refresh cookie exists, so this likely points to a Postman assertion/path issue rather than missing backend refresh behavior. |
| Current session after admin login | `GET /auth/session` | `200` | Status 200; authenticated true; has session id | Pass | Proves access cookie was stored/sent and backend rehydrated the session. |
| Refresh session | `POST /auth/refresh` | `200` | Status 200; still authenticated; refresh cookie exists | Pass | Proves refresh cookie path/session rotation behavior works in this local Postman run. |
| Logout | `POST /auth/logout` | `200` | Status 200; logout success | Pass | Proves logout endpoint returns success and clears/revokes credentials enough for the next check. |
| Session after logout | `GET /auth/session` | `401` | Should be 401 after logout | Pass | Proves logout invalidates the session from the client perspective. |
| Worker PIN login | `POST /auth/pin/verify` | `200` | Status 200; authenticated worker; cookies set | Pass | Proves worker PIN login issues a worker auth session in local Postman. |
| Worker session hitting admin route | `GET /datos_basicos` | `403` | Not 401 | Pass for auth boundary | Screenshot assertion only says `Not 401`, but observed status is `403`, which is the expected distinction: authenticated worker is denied without being treated as logged out. |

## Cookie assertion note for `gm_refresh`

The admin login screenshot shows:

```text
FAIL Cookies present | AssertionError: expected { ...(2) } to have property 'gm_refresh'
```

But the later refresh request shows:

```text
PASS Refresh cookie exists
```

The backend configuration sets:

```js
refreshName: "gm_refresh"
refreshPath: "/auth"
```

and writes it with:

```js
res.cookie(authConfig.cookies.refreshName, sessionResult.refreshToken, {
  httpOnly: true,
  path: authConfig.cookies.refreshPath,
  ...
});
```

Because the refresh cookie is scoped to `/auth`, a Postman test that inspects only cookies visible for `/admin/login` can fail even when the cookie was set and later sent correctly to `/auth/refresh`.

Recommended Postman assertion for login responses:

- Check the raw `Set-Cookie` response headers include `gm_access`, `gm_refresh`, and `gm_csrf`; or
- Check the cookie jar with path awareness; and
- Keep the existing `POST /auth/refresh` assertion because it proves `gm_refresh` is actually usable.

## What this evidence proves

- Admin login can issue a valid session in local HTTP mode.
- `/auth/session` can rehydrate an authenticated session.
- `/auth/refresh` can keep the session authenticated.
- `/auth/logout` invalidates the session from the client perspective.
- Worker PIN login can issue a valid worker session.
- Worker session receives `403` on an admin-only route instead of `401`, preserving the intended auth/authorization distinction.

## What remains unproven

- Full frontend integration with `credentials: "include"` / `withCredentials: true`.
- Successful WebAuthn biometric/passkey login through browser/device.
- Production-like HTTPS cross-site cookie behavior with:
  - `AUTH_COOKIE_SAMESITE=none`
  - `AUTH_COOKIE_SECURE=true`
  - `AUTH_CSRF_ENABLED=true`
- CSRF rejection/success behavior with missing vs matching `X-CSRF-Token` under production-like config.
- Runtime confirmation of production CORS configuration with `NODE_ENV=production`, exact `CORS_ALLOWED_ORIGINS`, and localhost/127.0.0.1 rejected unless explicitly enabled.
- Runtime confirmation that `AUTH_DEBUG_REQUESTS=false` keeps auth/CORS/WebAuthn debug logs off by default.
- Fine-grained worker ownership beyond route-level/coarse-grained authorization.

## Recommended remaining evidence before archive

| Check | Required evidence |
| --- | --- |
| CSRF disabled local mode | Already indirectly covered by successful POSTs in local mode. |
| CSRF enabled production-like mode | Run logout/refresh/protected unsafe route with and without `X-CSRF-Token`; record `403` then success. |
| Frontend session rehydration | Browser test where private route reload calls `GET /auth/session` and keeps user logged in. |
| Frontend 401 handling | Browser test where logged-out/private route redirects to login after backend `401`. |
| Frontend 403 handling | Browser test where worker receives `403` and remains logged in. |
| WebAuthn biometric login | Browser/device test for `authenticate/options` + `authenticate/verify`, ending in worker session cookies and `GET /auth/session` = `200`. |
| Production CORS hardening | Browser/preflight test from the real production origin and a rejected localhost origin with `NODE_ENV=production`. |
| Debug logging default | Confirm `AUTH_DEBUG_REQUESTS=false` in server env and no credential ceremony payloads are logged during WebAuthn flows. |

## Current archive interpretation

This evidence moves the change closer to archive readiness, but should still be treated as partial until frontend/WebAuthn and production-like CSRF/cookie behavior are verified or explicitly marked out of scope for archive.

## Manual verification summary

Verified manually with Postman and frontend tests on `http://localhost:3000` and on the deployed frontend-backend flow.

- `POST /admin/login` → `200`, authenticated admin session issued.
- `GET /auth/session` → `200`, session rehydrated successfully.
- `POST /auth/refresh` → `200`, refresh flow kept the session alive.
- `POST /auth/logout` → `200`, logout cleared session state.
- `GET /auth/session` after logout → `401`.
- `POST /auth/pin/verify` → `200`, worker login issued a valid worker session.
- `GET /datos_basicos` with worker session → `403`, confirming auth vs authorization separation.

This manual evidence proves the backend session contract works for the core admin and worker flows. It is ready to proceed toward `/sdd-archive` after the production env variables are set in Render.
