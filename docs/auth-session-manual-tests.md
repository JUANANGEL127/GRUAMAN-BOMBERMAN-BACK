# Auth Session Manual Test Plan

This guide describes how to manually verify the authentication/session contract implemented for the backend. It focuses on admin login, worker login by PIN, worker login by WebAuthn/passkey, session rehydration, refresh, logout, CSRF, and expected auth failures.

> Runtime verification requires a running backend, a PostgreSQL database with valid admin/worker data, and an HTTP client that preserves cookies. Do not use fake credentials in production-like tests.

## 1. Test prerequisites

### 1.1 Backend environment

Local HTTP testing can use:

```env
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

Production-like cross-site cookie testing must use HTTPS and CSRF:

```env
AUTH_COOKIE_SAMESITE=none
AUTH_COOKIE_SECURE=true
AUTH_CSRF_ENABLED=true
FRONTEND_URL=https://your-frontend.example
CORS_ALLOWED_ORIGINS=https://your-frontend.example
CORS_ALLOW_LOCALHOST=false
AUTH_DEBUG_REQUESTS=false
WEBAUTHN_RPID=your-frontend.example
WEBAUTHN_RPNAME=Gruaman Bomberman
WEBAUTHN_ORIGIN=https://your-frontend.example
```

The backend intentionally fails closed when `AUTH_COOKIE_SAMESITE=none` is used without both `AUTH_COOKIE_SECURE=true` and `AUTH_CSRF_ENABLED=true`.

`AUTH_DEBUG_REQUESTS=true` is only for temporary local diagnostics. Leave it `false` by default and never enable it as a normal production setting. When enabled, auth/CORS/WebAuthn debug logs are redacted and must show cookie names/status only, not cookie values, tokens, attestation responses, assertion responses, or generated WebAuthn options.

### 1.2 Postman environment variables

Create a Postman environment with:

| Variable | Example | Notes |
| --- | --- | --- |
| `baseUrl` | `http://localhost:3000` | Backend URL. Adjust the port to the running backend. |
| `adminPassword` | `<valid-admin-password>` | Must match a row in `admin_passwords`. |
| `workerCedula` | `<valid-worker-id-number>` | Must match `trabajadores.numero_identificacion`. |
| `workerName` | `<valid-worker-name>` | Used for WebAuthn registration options. |
| `workerPin` | `<valid-worker-pin>` | Required only if PIN is enabled and configured. |
| `csrfToken` | `<gm_csrf-cookie-value>` | Required only when `AUTH_CSRF_ENABLED=true`. |

Postman must keep cookies enabled. After login, verify that the cookie jar contains:

- `gm_access`: HttpOnly access JWT cookie.
- `gm_refresh`: HttpOnly refresh token cookie scoped to `/auth`.
- `gm_csrf`: non-HttpOnly CSRF cookie.

When CSRF is enabled, copy the `gm_csrf` cookie value into the `csrfToken` environment variable and send it as:

```http
X-CSRF-Token: {{csrfToken}}
```

## 1.3 Critical token storage rule

Do not store an auth token from the JSON response.

This backend uses cookie-based authentication:

| Cookie | Contains | HttpOnly | Who stores it | Who sends it |
| --- | --- | ---: | --- | --- |
| `gm_access` | Access JWT | Yes | Browser/Postman cookie jar | Browser/Postman automatically |
| `gm_refresh` | Opaque refresh token | Yes | Browser/Postman cookie jar | Browser/Postman automatically on `/auth/*` |
| `gm_csrf` | CSRF token | No | Browser/Postman cookie jar | Browser/Postman automatically as cookie; client must also copy it to `X-CSRF-Token` when CSRF is enabled |

The frontend must not copy `gm_access` or `gm_refresh` into `localStorage`, `sessionStorage`, Redux, Zustand, or any JS-accessible state. Those cookies are `HttpOnly`, so browser JavaScript cannot read them by design.

The frontend stores only user/session metadata returned by:

```http
GET {{baseUrl}}/auth/session
```

For example:

```json
{
  "authenticated": true,
  "user": {
    "actorType": "worker",
    "numeroIdentificacion": "<worker-cedula>",
    "nombre": "<worker-name>",
    "empresaSlug": "<empresa-name-or-slug>"
  },
  "session": {
    "id": "<session-jti>",
    "expiresAt": "<iso-date>"
  }
}
```

That metadata is UI state, not proof of authentication. The real proof is the cookie pair validated by the backend.

### What to do after PIN or WebAuthn login

After a successful `POST /auth/pin/verify` or `POST /webauthn/authenticate/verify`:

1. Do not look for `accessToken` in the JSON body.
2. Verify that the response includes `Set-Cookie` headers for `gm_access`, `gm_refresh`, and `gm_csrf`.
3. Verify that Postman/browser stored those cookies.
4. Call `GET /auth/session`.
5. If it returns `200`, the session is valid.
6. If it returns `401`, the cookie was not stored/sent or the session is invalid.

In browser/frontend requests, always use credentials:

```js
fetch(`${baseUrl}/auth/session`, {
  credentials: "include"
});
```

With Axios:

```js
axios.get(`${baseUrl}/auth/session`, {
  withCredentials: true
});
```

Without `credentials: "include"` / `withCredentials: true`, the browser will not send the cookies and the backend will correctly return `401`.

## 1.4 Local vs production-like configuration modes

There are two useful local test modes. Pick the one that matches what you are trying to prove.

### Mode A: Local HTTP functional testing

Use this when testing through plain `http://localhost`.

```env
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

This proves:

- Login issues cookies.
- Session rehydrates with `GET /auth/session`.
- `401` invalidates frontend session.
- `403` denies access without logging out.
- PIN login works.
- Basic WebAuthn local behavior can work if the browser accepts localhost as a secure context.

This does not fully prove production cookie behavior because production should use HTTPS, `Secure`, and usually CSRF.

### Mode B: Production-like HTTPS/cross-site testing

Use this when the frontend and backend run through HTTPS origins, even in a staging or tunnel setup.

```env
AUTH_COOKIE_SAMESITE=none
AUTH_COOKIE_SECURE=true
AUTH_CSRF_ENABLED=true
FRONTEND_URL=https://your-frontend-test-origin.example
WEBAUTHN_RPID=your-frontend-test-origin.example
WEBAUTHN_RPNAME=Gruaman Bomberman
WEBAUTHN_ORIGIN=https://your-frontend-test-origin.example
```

This proves the behavior closest to production:

- Cross-site credentialed cookies.
- CSRF enforcement.
- HTTPS-only cookies.
- WebAuthn origin/RP validation.

Important: do not use `AUTH_COOKIE_SECURE=true` with plain `http://localhost` unless you know the client/browser behavior you are testing. Secure cookies are meant for HTTPS. If cookies are not saved or not sent, `GET /auth/session` will return `401` even after a successful login response.

## 2. Common expected auth errors

### 2.1 Missing or invalid session

Request any protected endpoint without valid cookies.

Expected response:

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_TOKEN_MISSING",
    "message": "Unauthorized"
  }
}
```

Other possible `401` auth codes:

```json
{ "success": false, "error": { "code": "AUTH_TOKEN_EXPIRED", "message": "Unauthorized" } }
```

```json
{ "success": false, "error": { "code": "AUTH_TOKEN_INVALID", "message": "Unauthorized" } }
```

```json
{ "success": false, "error": { "code": "AUTH_SESSION_REVOKED", "message": "Unauthorized" } }
```

### 2.2 Authenticated but not allowed

Expected response when the user has a valid session but lacks the required role/permission:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "Forbidden"
  }
}
```

A `403` must deny the action but should not force the frontend to log out automatically.

## 3. Admin authentication flow

### 3.1 Admin login succeeds

Request:

```http
POST {{baseUrl}}/admin/login
Content-Type: application/json
```

Body:

```json
{
  "password": "{{adminPassword}}"
}
```

Expected response:

```http
HTTP/1.1 200 OK
Set-Cookie: gm_access=...; HttpOnly; Path=/; ...
Set-Cookie: gm_refresh=...; HttpOnly; Path=/auth; ...
Set-Cookie: gm_csrf=...; Path=/; ...
```

Expected body shape:

```json
{
  "success": true,
  "rol": "<admin-role>",
  "authenticated": true,
  "user": {
    "id": "<admin-id>",
    "actorType": "admin",
    "roles": ["admin:<admin-role>"],
    "permissions": ["admin:read", "admin:<admin-role>:*"],
    "adminId": "<admin-id>",
    "adminRole": "<admin-role>"
  },
  "session": {
    "id": "<session-jti>",
    "expiresAt": "<iso-date>"
  }
}
```

Validation points:

- Response status is `200`.
- Body includes `authenticated: true`.
- `user.actorType` is `admin`.
- `rol` is still returned for legacy frontend compatibility.
- Postman cookie jar stores `gm_access`, `gm_refresh`, and `gm_csrf`.

### 3.2 Admin login without password fails

Request:

```http
POST {{baseUrl}}/admin/login
Content-Type: application/json
```

Body:

```json
{}
```

Expected response:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Falta la contraseña"
}
```

### 3.3 Admin login with wrong password fails

Request:

```http
POST {{baseUrl}}/admin/login
Content-Type: application/json
```

Body:

```json
{
  "password": "wrong-password"
}
```

Expected response:

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "error": "Error en login, contacte a su Administrador"
}
```

After 10 failed attempts from the same IP within 15 minutes, expected response:

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": "Demasiados intentos. Espera 15 minutos."
}
```

## 4. Session lifecycle flow

Run this flow after a successful admin login or successful worker login.

### 4.1 Rehydrate current session

Request:

```http
GET {{baseUrl}}/auth/session
```

Body: none.

Expected response:

```http
HTTP/1.1 200 OK
```

Expected body shape:

```json
{
  "authenticated": true,
  "user": {
    "id": "<actor-id>",
    "actorType": "admin|worker",
    "roles": ["<role>"],
    "permissions": ["<permission>"]
  },
  "session": {
    "id": "<session-jti>",
    "expiresAt": "<iso-date>"
  }
}
```

Validation points:

- Reload-like checks must use this endpoint.
- `200` means the frontend can keep the user logged in.
- `401` means the frontend must clear auth state and redirect to login.

### 4.2 Refresh session

Request:

```http
POST {{baseUrl}}/auth/refresh
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body:

```json
{}
```

If `AUTH_CSRF_ENABLED=false`, the `X-CSRF-Token` header is not required.

Expected response:

```http
HTTP/1.1 200 OK
Set-Cookie: gm_access=...; HttpOnly; Path=/; ...
Set-Cookie: gm_refresh=...; HttpOnly; Path=/auth; ...
Set-Cookie: gm_csrf=...; Path=/; ...
```

Expected body shape:

```json
{
  "authenticated": true,
  "user": {
    "actorType": "admin|worker"
  },
  "session": {
    "id": "<same-or-rotated-session-id>",
    "expiresAt": "<iso-date>"
  }
}
```

Validation points:

- Refresh rotates the refresh token cookie.
- A following `GET /auth/session` should still return `200`.

### 4.3 Logout

Request:

```http
POST {{baseUrl}}/auth/logout
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body:

```json
{}
```

If `AUTH_CSRF_ENABLED=false`, the `X-CSRF-Token` header is not required.

Expected response:

```http
HTTP/1.1 200 OK
Set-Cookie: gm_access=; ...
Set-Cookie: gm_refresh=; ...
Set-Cookie: gm_csrf=; ...
```

Expected body:

```json
{
  "success": true
}
```

Then call:

```http
GET {{baseUrl}}/auth/session
```

Expected response:

```http
HTTP/1.1 401 Unauthorized
```

## 5. Worker PIN authentication flow

Use this when the worker has PIN authentication enabled.

### 5.1 Check PIN status

Request:

```http
GET {{baseUrl}}/auth/pin/status?numero_identificacion={{workerCedula}}
```

Body: none.

Expected success response:

```http
HTTP/1.1 200 OK
```

```json
{
  "pinHabilitado": true,
  "pinConfigurado": true,
  "activo": true
}
```

Other expected responses:

Missing cedula:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Falta numero_identificacion"
}
```

Unknown worker:

```http
HTTP/1.1 404 Not Found
```

```json
{
  "error": "Usuario no encontrado"
}
```

Inactive worker:

```http
HTTP/1.1 200 OK
```

```json
{
  "pinHabilitado": false,
  "pinConfigurado": false,
  "activo": false
}
```

### 5.2 Worker PIN login succeeds

Request:

```http
POST {{baseUrl}}/auth/pin/verify
Content-Type: application/json
```

Body:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "pin": "{{workerPin}}"
}
```

Expected response:

```http
HTTP/1.1 200 OK
Set-Cookie: gm_access=...; HttpOnly; Path=/; ...
Set-Cookie: gm_refresh=...; HttpOnly; Path=/auth; ...
Set-Cookie: gm_csrf=...; Path=/; ...
```

Expected body shape:

```json
{
  "success": true,
  "authenticated": true,
  "user": {
    "id": "<worker-id>",
    "actorType": "worker",
    "roles": ["worker"],
    "permissions": ["forms:create", "forms:read:self", "session:read"],
    "numeroIdentificacion": "<worker-cedula>",
    "nombre": "<worker-name>",
    "empresaId": "<empresa-id>",
    "empresaSlug": "<empresa-name-or-slug>",
    "obraId": "<obra-id>",
    "cargo": "<cargo-or-null>"
  },
  "session": {
    "id": "<session-jti>",
    "expiresAt": "<iso-date>"
  }
}
```

Validation points:

- `user.actorType` must be `worker`.
- `user.numeroIdentificacion` must match `{{workerCedula}}`.
- Cookies must be stored.
- A following `GET /auth/session` must return the same worker session.

### 5.3 Worker PIN login failures

Missing data:

```json
{}
```

Expected:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Faltan datos"
}
```

PIN disabled:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "error": "Este usuario no tiene PIN habilitado"
}
```

PIN not configured:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "PIN no configurado",
  "requiereCrearPin": true
}
```

Wrong PIN:

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "success": false,
  "error": "PIN incorrecto"
}
```

Inactive worker:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "authenticated": false,
  "activo": false,
  "error": "Usuario inactivo"
}
```

After 10 failed attempts from the same IP within 15 minutes:

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": "Demasiados intentos. Espera 15 minutos."
}
```

### 5.4 Set or update worker PIN

This endpoint is protected. The caller must be either:

- The same authenticated worker identified by `numero_identificacion`, or
- An authenticated admin.

Request:

```http
POST {{baseUrl}}/auth/pin/set
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "pin": "1234"
}
```

If `AUTH_CSRF_ENABLED=false`, the `X-CSRF-Token` header is not required.

Expected success response:

```http
HTTP/1.1 200 OK
```

```json
{
  "success": true
}
```

Invalid PIN format:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "pin": "12ab"
}
```

Expected:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "El PIN debe ser numérico de 4 a 8 dígitos"
}
```

PIN not enabled for the worker:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "error": "Este usuario no tiene PIN habilitado"
}
```

Different worker trying to set another worker's PIN:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "Forbidden"
  }
}
```

## 6. Worker WebAuthn/passkey authentication flow

Important: WebAuthn verification cannot be fully tested with plain Postman because `attestationResponse` and `assertionResponse` must be created by the browser through `navigator.credentials` or by the frontend WebAuthn library. Postman can test the `options` endpoints and backend error paths, but successful `verify` calls require a real browser/device ceremony.

### 6.1 Check if the worker has a passkey

Request:

```http
POST {{baseUrl}}/webauthn/hasCredential
Content-Type: application/json
```

Body:

```json
{
  "numero_identificacion": "{{workerCedula}}"
}
```

Expected response:

```http
HTTP/1.1 200 OK
```

```json
{
  "hasCredential": true,
  "activo": true
}
```

Missing cedula:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Falta numero_identificacion"
}
```

Inactive worker:

```http
HTTP/1.1 200 OK
```

```json
{
  "hasCredential": false,
  "activo": false
}
```

### 6.2 Generate WebAuthn authentication options

Request:

```http
POST {{baseUrl}}/webauthn/authenticate/options
Content-Type: application/json
```

Body:

```json
{
  "numero_identificacion": "{{workerCedula}}"
}
```

Expected response:

```http
HTTP/1.1 200 OK
```

Expected body shape:

```json
{
  "challenge": "<challenge>",
  "timeout": 60000,
  "rpId": "<configured-rp-id>",
  "allowCredentials": [
    {
      "id": "<credential-id>",
      "type": "public-key",
      "transports": ["internal", "hybrid", "usb", "ble", "nfc"]
    }
  ],
  "userVerification": "preferred"
}
```

If there are no credentials:

```http
HTTP/1.1 404 Not Found
```

```json
{
  "error": "No hay credenciales para este usuario",
  "mensaje": "Este dispositivo no tiene llaves de acceso registradas. Por favor, registre primero una llave de acceso.",
  "requiereRegistro": true
}
```

Inactive worker:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "authenticated": false,
  "activo": false,
  "error": "Usuario inactivo"
}
```

### 6.3 Verify WebAuthn authentication response

This request must be created by the browser after calling WebAuthn with the options from step 6.2.

Request:

```http
POST {{baseUrl}}/webauthn/authenticate/verify
Content-Type: application/json
```

Body shape:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "assertionResponse": {
    "id": "<credential-id>",
    "rawId": "<base64url-raw-id>",
    "response": {
      "authenticatorData": "<base64url-authenticator-data>",
      "clientDataJSON": "<base64url-client-data-json>",
      "signature": "<base64url-signature>",
      "userHandle": "<base64url-user-handle-or-null>"
    },
    "type": "public-key",
    "clientExtensionResults": {},
    "authenticatorAttachment": "platform|cross-platform"
  }
}
```

Expected success response:

```http
HTTP/1.1 200 OK
Set-Cookie: gm_access=...; HttpOnly; Path=/; ...
Set-Cookie: gm_refresh=...; HttpOnly; Path=/auth; ...
Set-Cookie: gm_csrf=...; Path=/; ...
```

Expected body shape:

```json
{
  "success": true,
  "authenticated": true,
  "user": {
    "actorType": "worker",
    "numeroIdentificacion": "<worker-cedula>"
  },
  "session": {
    "id": "<session-jti>",
    "expiresAt": "<iso-date>"
  }
}
```

Expected failures:

No challenge generated first:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "No hay challenge para este usuario"
}
```

Credential not found:

```http
HTTP/1.1 404 Not Found
```

```json
{
  "error": "Credencial no encontrada"
}
```

Invalid browser response:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Verificación fallida"
}
```

Inactive worker:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "authenticated": false,
  "activo": false,
  "error": "Usuario inactivo"
}
```

### 6.4 Register a new WebAuthn/passkey credential

Registration is protected. The caller must already have a valid session and must be either:

- The same authenticated worker, or
- An authenticated admin.

#### 6.4.1 Generate registration options

Request:

```http
POST {{baseUrl}}/webauthn/register/options
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "nombre": "{{workerName}}"
}
```

If `AUTH_CSRF_ENABLED=false`, the `X-CSRF-Token` header is not required.

Expected success response:

```http
HTTP/1.1 200 OK
```

Expected body shape:

```json
{
  "challenge": "<challenge>",
  "rp": {
    "name": "<configured-rp-name>",
    "id": "<configured-rp-id>"
  },
  "user": {
    "id": "<base64url-worker-id>",
    "name": "<worker-name>",
    "displayName": "<worker-name>"
  },
  "pubKeyCredParams": [
    { "alg": -7, "type": "public-key" }
  ],
  "timeout": 60000,
  "attestation": "none",
  "excludeCredentials": []
}
```

#### 6.4.2 Verify registration response

This body must be generated by the browser after calling WebAuthn with the registration options.

Request:

```http
POST {{baseUrl}}/webauthn/register/verify
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body shape:

```json
{
  "numero_identificacion": "{{workerCedula}}",
  "attestationResponse": {
    "id": "<credential-id>",
    "rawId": "<base64url-raw-id>",
    "response": {
      "attestationObject": "<base64url-attestation-object>",
      "clientDataJSON": "<base64url-client-data-json>"
    },
    "type": "public-key",
    "clientExtensionResults": {},
    "authenticatorAttachment": "platform|cross-platform"
  }
}
```

Expected success response:

```http
HTTP/1.1 200 OK
```

```json
{
  "success": true
}
```

No challenge generated first:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "No hay challenge para este usuario"
}
```

Invalid browser response:

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "Verificación fallida"
}
```

## 7. Protected route checks

### 7.1 Anonymous request to protected route

Use any protected endpoint. Example:

```http
GET {{baseUrl}}/datos_basicos
```

Expected:

```http
HTTP/1.1 401 Unauthorized
```

Expected body shape:

```json
{
  "success": false,
  "error": {
    "code": "AUTH_TOKEN_MISSING",
    "message": "Unauthorized"
  }
}
```

### 7.2 Admin session accesses admin route

First login as admin, then call:

```http
GET {{baseUrl}}/datos_basicos
```

Expected:

- Status should be the normal route response, not `401` or `403`.
- The body depends on the existing endpoint data.

### 7.3 Worker session is denied from admin route

First login as worker by PIN or WebAuthn, then call:

```http
GET {{baseUrl}}/datos_basicos
```

Expected:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "Forbidden"
  }
}
```

Then call:

```http
GET {{baseUrl}}/auth/session
```

Expected:

```http
HTTP/1.1 200 OK
```

This proves `403` denied the action without invalidating the session.

## 8. CSRF checks

Run this section only when `AUTH_CSRF_ENABLED=true`.

### 8.1 Unsafe request without CSRF header fails

After login, call:

```http
POST {{baseUrl}}/auth/logout
Content-Type: application/json
```

Body:

```json
{}
```

Expected:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "Forbidden"
  }
}
```

### 8.2 Unsafe request with matching CSRF header succeeds

Copy the value of the `gm_csrf` cookie into `{{csrfToken}}`, then call:

```http
POST {{baseUrl}}/auth/logout
Content-Type: application/json
X-CSRF-Token: {{csrfToken}}
```

Body:

```json
{}
```

Expected:

```http
HTTP/1.1 200 OK
```

```json
{
  "success": true
}
```

## 9. Frontend/browser WebAuthn verification notes

For WebAuthn success-path testing, prefer the existing React/Vite frontend or a browser page served from `WEBAUTHN_ORIGIN`. The backend expects the browser-generated payloads to match:

- `WEBAUTHN_RPID`
- `WEBAUTHN_ORIGIN`
- The challenge previously generated for the same `numero_identificacion`
- The credential registered for that worker

If the frontend and backend are deployed on different origins, requests must include credentials:

```js
fetch(`${baseUrl}/auth/session`, {
  credentials: "include"
});
```

For unsafe requests when CSRF is enabled:

```js
fetch(`${baseUrl}/auth/logout`, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfTokenFromCookie
  },
  body: JSON.stringify({})
});
```

## 10. Runtime verification evidence checklist

Record the result of each item before running SDD verify/archive.

| Check | Expected | Actual |
| --- | --- | --- |
| `GET /auth/session` anonymous | `401 AUTH_TOKEN_MISSING` |  |
| `POST /admin/login` valid password | `200`, admin session cookies |  |
| `GET /auth/session` after admin login | `200`, `actorType=admin` |  |
| Protected admin route with admin session | Not `401`/`403` |  |
| `POST /auth/logout` | `200`, cookies cleared |  |
| `POST /auth/pin/verify` valid worker PIN | `200`, `actorType=worker`, cookies |  |
| `GET /auth/session` after worker PIN login | `200`, `actorType=worker` |  |
| Worker session calling admin route | `403 AUTH_FORBIDDEN` |  |
| `GET /auth/session` after worker `403` | `200`, session still valid |  |
| `POST /webauthn/hasCredential` | `200`, boolean result |  |
| `POST /webauthn/authenticate/options` | `200` options or `404 requiereRegistro=true` |  |
| Browser WebAuthn authenticate verify | `200`, worker session cookies |  |
| CSRF missing header when enabled | `403 AUTH_FORBIDDEN` |  |
| CSRF matching header when enabled | Request succeeds according to route behavior |  |
| `POST /auth/refresh` | `200`, fresh cookies |  |
| `GET /auth/session` after logout | `401` |  |

## 11. What cannot be proven with Postman alone

- Successful WebAuthn registration or authentication, because the browser/device must create `attestationResponse` or `assertionResponse`.
- Real mobile biometric/passkey behavior without testing on the target device/browser.
- Frontend redirect behavior, because that belongs to the React/Vite app.
- Fine-grained worker ownership over historical business records, because current schema does not consistently store durable worker ownership keys for all form tables.
