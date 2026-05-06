# Auth Session Operations

This document supports runtime verification and deployment for the `auth-session-backend-contract` SDD change. It does not prove runtime behavior by itself. Archive readiness still requires executing the checklist against a running backend, PostgreSQL database, and an HTTP client/browser that preserves cookies.

## Local `.env` vs server environment

Local development may use `.env` or `.env.local` to make manual testing easier. Deployment must create the equivalent variables in the hosting provider/server environment; do not rely on committing local secret files.

Important: the auth-session implementation fails closed when required secrets or unsafe cookie combinations are missing. That is intentional. A backend that cannot prove session integrity should not issue sessions.

## Required server variables before deployment

| Variable | Required | Local development recommendation | Production recommendation | Purpose |
| --- | --- | --- | --- | --- |
| `AUTH_JWT_SECRET` | Yes | Generate a long random value. Do not reuse database or VAPID secrets. | Required; store only in the server/hosting secret manager. | HMAC secret used to sign and verify access JWTs. |
| `AUTH_JWT_ISSUER` | No | `gruaman-bomberman-back` | `gruaman-bomberman-back` | JWT issuer validation value. |
| `AUTH_JWT_AUDIENCE` | No | `gruaman-bomberman-front` | `gruaman-bomberman-front` | JWT audience validation value. |
| `AUTH_ACCESS_TTL_SECONDS` | No | `900` | `900` or another short value. | Access cookie lifetime. |
| `AUTH_REFRESH_TTL_SECONDS` | No | `604800` | `604800` or approved session lifetime. | Refresh/session lifetime. |
| `AUTH_COOKIE_SECURE` | Environment-dependent | `false` for plain `http://localhost`. | `true`. Required if `AUTH_COOKIE_SAMESITE=none`. | Adds the Secure cookie flag. |
| `AUTH_COOKIE_SAMESITE` | Environment-dependent | `lax` unless testing cross-site cookies. | `lax` for same-site deployments; `none` for cross-site frontend/backend. | Controls browser cross-site cookie sending. |
| `AUTH_CSRF_ENABLED` | Environment-dependent | `false` with `SameSite=lax`; `true` when testing `SameSite=none`. | `true` when `AUTH_COOKIE_SAMESITE=none`. | Enables double-submit CSRF checks for unsafe credentialed requests. |
| `AUTH_CSRF_HEADER_NAME` | No | `x-csrf-token` | `x-csrf-token` | Header expected by CSRF middleware. |
| `FRONTEND_URL` | Yes for deployed frontend | `http://localhost:4000` or your Vite dev URL. | Exact frontend origin, for example `https://example-front.onrender.com`. | Primary explicit CORS origin when credentials are used. |
| `CORS_ALLOWED_ORIGINS` | No | Empty, or comma-separated local origins. | Comma-separated production frontend origins. | Additional exact credentialed CORS origins. |
| `CORS_ALLOW_LOCALHOST` | No | Defaults to `true` outside production. | Defaults to `false` in production. Use `true` only for an intentional production diagnostic. | Controls whether localhost/127.0.0.1 origins are accepted for credentialed CORS. |
| `AUTH_DEBUG_REQUESTS` | No | `false`; set `true` only while diagnosing local browser auth/CORS issues. | `false`. | Enables temporary redacted auth/CORS/WebAuthn debug logs. |
| `WEBAUTHN_RPID` | Required for WebAuthn | `localhost` when testing local WebAuthn. | Production relying-party domain, without protocol. | WebAuthn relying-party ID. |
| `WEBAUTHN_RPNAME` | Required for WebAuthn | `Gruaman Bomberman` | `Gruaman Bomberman` | WebAuthn relying-party display name. |
| `WEBAUTHN_ORIGIN` | Required for WebAuthn | `http://localhost:4000` or the frontend origin used for passkeys. | Exact frontend origin, including protocol. | WebAuthn expected origin. |

## Safe configuration rules enforced by code

- `AUTH_COOKIE_SAMESITE=none` with `AUTH_COOKIE_SECURE=false` is rejected at startup.
- `AUTH_COOKIE_SAMESITE=none` with `AUTH_CSRF_ENABLED=false` is rejected at startup.
- Local defaults remain usable: `SameSite=lax`, `Secure=false`, CSRF disabled unless explicitly enabled.
- Credentialed CORS uses exact allowed origins. Localhost/127.0.0.1 is allowed by default only outside `NODE_ENV=production`.
- WebAuthn debug logs are redacted and gated by `AUTH_DEBUG_REQUESTS=true`; credential payloads, attestation/assertion responses, and generated WebAuthn options must not be logged.

## Example local testing variables

Use this only for local manual verification over plain HTTP:

```env
AUTH_JWT_SECRET=replace-with-a-long-random-local-secret
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_SECURE=false
AUTH_CSRF_ENABLED=false
FRONTEND_URL=http://localhost:4000
CORS_ALLOW_LOCALHOST=true
AUTH_DEBUG_REQUESTS=false
WEBAUTHN_RPID=localhost
WEBAUTHN_RPNAME=Gruaman Bomberman Local
WEBAUTHN_ORIGIN=http://localhost:4000
```

For local cross-site cookie testing over HTTPS-like deployment behavior, use:

```env
AUTH_JWT_SECRET=replace-with-a-long-random-local-secret
AUTH_COOKIE_SAMESITE=none
AUTH_COOKIE_SECURE=true
AUTH_CSRF_ENABLED=true
FRONTEND_URL=https://your-frontend-test-origin.example
CORS_ALLOWED_ORIGINS=https://your-frontend-test-origin.example
CORS_ALLOW_LOCALHOST=false
AUTH_DEBUG_REQUESTS=false
```

## Example production variables

```env
AUTH_JWT_SECRET=<long-random-secret-from-secret-manager>
AUTH_JWT_ISSUER=gruaman-bomberman-back
AUTH_JWT_AUDIENCE=gruaman-bomberman-front
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_SECONDS=604800
AUTH_COOKIE_SAMESITE=none
AUTH_COOKIE_SECURE=true
AUTH_CSRF_ENABLED=true
AUTH_CSRF_HEADER_NAME=x-csrf-token
FRONTEND_URL=https://your-production-frontend.example
CORS_ALLOWED_ORIGINS=https://your-production-frontend.example
CORS_ALLOW_LOCALHOST=false
AUTH_DEBUG_REQUESTS=false
WEBAUTHN_RPID=your-production-frontend.example
WEBAUTHN_RPNAME=Gruaman Bomberman
WEBAUTHN_ORIGIN=https://your-production-frontend.example
```

If frontend and backend are same-site in production, `AUTH_COOKIE_SAMESITE=lax` can be simpler and reduces CSRF exposure. If they are cross-site, use `SameSite=None; Secure` and CSRF.

## Postman-style manual verification

Postman can verify most auth/session behavior if cookies are preserved between requests. Use a Postman environment with:

- `baseUrl`: backend URL, for example `http://localhost:3000`.
- `csrfToken`: set manually from the `gm_csrf` cookie value after login when CSRF is enabled.

### 1. Missing session returns 401

Request:

```http
GET {{baseUrl}}/auth/session
```

Expected:

- Status `401`.
- Body includes `error.code = "AUTH_TOKEN_MISSING"`.

### 2. Admin login issues cookies

Request:

```http
POST {{baseUrl}}/admin/login
Content-Type: application/json

{ "password": "<valid-admin-password>" }
```

Expected:

- Status `200`.
- Body includes `success: true`, `rol`, `authenticated: true`, `user`, `session`.
- Response has `Set-Cookie` headers for access, refresh, and CSRF cookies.
- Postman cookie jar stores those cookies for `{{baseUrl}}`.

### 3. Session rehydrates after login

Request:

```http
GET {{baseUrl}}/auth/session
```

Expected:

- Status `200`.
- Body includes `authenticated: true`.
- `user.actorType` is `admin` or `worker` depending on the login flow.

### 4. Protected admin route accepts admin session

Request one protected admin endpoint that exists in the environment, for example:

```http
GET {{baseUrl}}/datos_basicos
```

Expected:

- Admin session: status should be a normal endpoint response, not `401`.
- Anonymous request: status `401`.
- Worker session: status `403`.

### 5. Worker PIN login issues worker session

Request:

```http
POST {{baseUrl}}/auth/pin/verify
Content-Type: application/json

{ "numero_identificacion": "<worker-id-number>", "pin": "<valid-pin>" }
```

Expected:

- Status `200`.
- Body includes `authenticated: true`.
- `user.actorType = "worker"`.
- Cookies are set.

### 6. CSRF behavior when enabled

Only run this when `AUTH_CSRF_ENABLED=true`.

Without header:

```http
POST {{baseUrl}}/auth/logout
```

Expected:

- Status `403`.

With header:

```http
POST {{baseUrl}}/auth/logout
X-CSRF-Token: {{csrfToken}}
```

Expected:

- Status `200`.
- Cookies are cleared.
- A following `GET /auth/session` returns `401`.

Also test one protected unsafe business route with and without `X-CSRF-Token`. It should fail without the header and continue to route behavior with the header.

### 7. Logout revokes session

After a valid login, call:

```http
POST {{baseUrl}}/auth/logout
X-CSRF-Token: {{csrfToken}}
```

Expected:

- Status `200`.
- Cookies are cleared.
- `GET /auth/session` returns `401`.

### 8. Refresh behavior

After a valid login, call:

```http
POST {{baseUrl}}/auth/refresh
X-CSRF-Token: {{csrfToken}}
```

Expected:

- Status `200` with `authenticated: true` and fresh cookies.

Then clear or corrupt the refresh cookie in Postman and call refresh again.

Expected:

- Status `401`.
- Frontend should treat the user as logged out.

## Browser/frontend checks

The frontend must call protected backend endpoints with credentials enabled:

```js
fetch(url, { credentials: "include" })
```

Required browser outcomes:

- Reloading a private route calls `GET /auth/session` and preserves the user when status is `200`.
- A `401` from backend clears frontend auth state and redirects to login.
- A `403` denies the action but does not force logout.

## Worker ownership viability

Fine-grained worker ownership is only partially viable with the current schema.

### What is viable now

- Credential-management ownership is viable because session claims include `numeroIdentificacion`, and the request body includes `numero_identificacion`.
- `POST /push/subscribe` ownership is viable for the same reason.
- Admin vs worker route-level authorization is viable because sessions now include `actorType`, `roles`, and `permissions`.

### What is not reliable yet

Most worker form tables are not consistently linked to `trabajadores.id`, `empresa_id`, `obra_id`, or `numero_identificacion`. Many records store only `nombre_operador` and `nombre_proyecto` as free text. That is not strong ownership evidence because names can collide, change, or be typed inconsistently.

Examples observed in the current schema:

- `permiso_trabajo`, `chequeo_alturas`, `chequeo_torregruas`, `inspeccion_epcc`, and `inspeccion_izaje` store `nombre_operador` / `nombre_proyecto`, but not a durable worker foreign key.
- `planilla_bombeo` stores `nombre_operador` and `nombre_auxiliar`, but not a durable worker foreign key.
- `horas_jornada` has `empresa_id`, but does not consistently bind to a worker foreign key.

### Recommended next hardening change

Add durable ownership columns to form tables where worker ownership matters:

- `trabajador_id INT REFERENCES trabajadores(id)`
- `empresa_id INT REFERENCES empresas(id)`
- `obra_id INT REFERENCES obras(id)`
- optionally `created_by_session_jti VARCHAR(100)` for auditability

Then update create/read/update queries so workers can only operate on records matching their session scope, while admins keep broader access based on role.

## Out of scope for this change

- Offline real authentication.
- Full per-record ownership enforcement across all historical form data.
- Provider verification for `POST /signio/webhook`.
- Admin user model redesign beyond existing `admin_passwords` role rows.
- Automated test suite setup, unless approved as a separate implementation decision.

## Production environment variables for Render

Use these values for the backend deployment secrets and configuration when frontend and backend are deployed separately on Render.

| Variable | Value / recommendation | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | Long random secret stored in Render secrets | JWT signing secret for access tokens |
| `AUTH_COOKIE_SAMESITE` | `none` | Required for cross-site frontend/backend cookie delivery |
| `AUTH_COOKIE_SECURE` | `true` | Required for `SameSite=None` cookies in production |
| `AUTH_CSRF_ENABLED` | `true` | Protects unsafe credentialed requests when cookies are cross-site |
| `AUTH_CSRF_HEADER_NAME` | `x-csrf-token` | Header expected by CSRF middleware |
| `FRONTEND_URL` | `https://gruaman-bomberman-front.onrender.com` | Exact frontend origin for CORS and CSRF |
| `AUTH_JWT_ISSUER` | `gruaman-bomberman-back` | JWT issuer validation value |
| `AUTH_JWT_AUDIENCE` | `gruaman-bomberman-front` | JWT audience validation value |
| `AUTH_ACCESS_TTL_SECONDS` | `900` | Short-lived access token lifetime |
| `AUTH_REFRESH_TTL_SECONDS` | `604800` | Refresh token/session lifetime |
| `CORS_ALLOWED_ORIGINS` | `https://gruaman-bomberman-front.onrender.com` | Exact allowed credentialed origin |
| `CORS_ALLOW_LOCALHOST` | `false` | Disable localhost origin acceptance in production |
| `AUTH_DEBUG_REQUESTS` | `false` | Disable auth/CORS/WebAuthn debug logging in production |
| `WEBAUTHN_RPID` | `gruaman-bomberman-front.onrender.com` | WebAuthn relying-party ID for production |
| `WEBAUTHN_RPNAME` | `Gruaman Bomberman` | WebAuthn relying-party display name |
| `WEBAUTHN_ORIGIN` | `https://gruaman-bomberman-front.onrender.com` | WebAuthn origin expected by the backend |

> Notes:
> - Store secrets in Render's secret manager. Do not commit production secrets to Git.
> - If your backend uses a `DATABASE_URL` secret, set that in Render instead of raw PG env vars.
> - Do not use `AUTH_COOKIE_SAMESITE=none` with `AUTH_COOKIE_SECURE=false` in production.
> - `FRONTEND_URL` must exactly match the deployed frontend origin used by the browser.
