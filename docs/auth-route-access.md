# Auth Route Access Matrix

This matrix documents the Phase 5 auth-session guard rollout for `auth-session-backend-contract`.

## Public routes

These routes remain callable without a session because they are part of authentication, discovery, provider callbacks, public key distribution, or login/onboarding lookups.

| Route | Reason |
| --- | --- |
| `POST /admin/login` | Admin authentication entry point; issues the backend session on success. |
| `GET /auth/session` | Session rehydration endpoint; validates cookies internally and returns `401` when invalid. |
| `POST /auth/refresh` | Session lifecycle endpoint; validates refresh cookie internally and returns `401` when invalid. |
| `POST /auth/logout` | Session lifecycle endpoint; revokes/clears cookies when present and is safe to call during logout cleanup. |
| `GET /auth/pin/status` | Login discovery for PIN availability. |
| `POST /auth/pin/verify` | Worker PIN authentication entry point; issues the backend session on success. |
| `POST /webauthn/hasCredential` | Login discovery for passkey availability. |
| `POST /webauthn/authenticate/options` | WebAuthn authentication ceremony start. |
| `POST /webauthn/authenticate/verify` | WebAuthn authentication ceremony verification; issues the backend session on success. |
| `POST /signio/webhook` | Public-facing Signio provider callback; must be secured separately with provider verification later. |
| `GET /roles/empresas` | Public company lookup used by onboarding/login-like flows. |
| `GET /nombres_trabajadores` | Public worker-name lookup retained for compatibility with existing flows. |
| `GET /obras` | Public works lookup retained for compatibility with existing flows. |
| `GET /bombas` | Public pump lookup retained for compatibility with existing flows. |
| `GET /push/subscribe/schema` | Developer payload documentation only. |
| `GET /vapid-public-key` | Browser push-subscription public key. |

## Protected credential-management routes

| Route | Guard |
| --- | --- |
| `POST /auth/pin/set` | Requires a valid session. Allows an admin or the worker whose `numero_identificacion` matches the request body. |
| `POST /webauthn/register/options` | Requires a valid session. Allows an admin or the matching worker. |
| `POST /webauthn/register/verify` | Requires a valid session. Allows an admin or the matching worker. |

## Protected admin routes

| Route group | Guard |
| --- | --- |
| `/api/*` | Authenticated admin with `admin:read`. |
| `/administrador/*` | Authenticated admin with `admin:read`, unless a narrower mount is listed below. |
| `/administrador/registros_diarios/*` | Authenticated admin with `admin:read`. |
| `/administrador/indicador_central/*` | Authenticated admin with `admin:read`. |
| `/administrador/admin_horas_extra/*` | Authenticated admin with `admin:read`. |
| `/permiso_trabajo_admin/*` | Authenticated admin with `admin:read`. |
| `/admin_usuarios/*` | Authenticated admin with `admin:read`. |
| `/admin_obras/*` | Authenticated admin with `admin:read`. |
| Gruaman admin mounts (`/inspeccion_izaje_admin`, `/inspeccion_epcc_admins`, `/chequeo_torregruas_admin`, `/chequeo_elevador_admin`, `/chequeo_alturas_admin`) | Authenticated admin with `admin:gruaman:*`. |
| Bomberman admin mounts (`/planilla_bombeo_admin`, `/inventarios_obra_admin`, `/inspeccion_epcc_bomberman_admin`, `/checklist_admin`, `/herramientas_mantenimiento_admin`, `/kit_limpieza_admin`) | Authenticated admin with `admin:bomberman:*`. |
| Non-webhook Signio routes (`/signio/enviar-firma`, `/signio/estado/:id_transaccion`, `/signio/documento/:id_transaccion`, `/signio/listar`) | Authenticated admin with `admin:read`. |

## Protected worker/form routes

| Route group | Guard |
| --- | --- |
| `/compartido/*` | Authenticated worker or admin. |
| `/gruaman/*` | Authenticated worker or admin. |
| `/bomberman/*` | Authenticated worker or admin. |
| `/horas_jornada/*` | Authenticated worker or admin. |
| `/sst/pqr/*` | Authenticated worker or admin. |
| `POST /validar_ubicacion` | Authenticated worker or admin. |
| `GET /trabajador_id` | Authenticated worker or admin. |
| `POST /push/subscribe` | Authenticated admin or matching worker by `numero_identificacion`. |

## Protected worker/admin identity routes

| Route | Guard |
| --- | --- |
| `POST /datos_basicos` | Authenticated admin with `admin:read`. |
| `GET /datos_basicos` | Authenticated admin with `admin:read`. |

## Known coarse-grained authorization gaps

- Worker form routes are protected by authentication and known actor role only. They do not yet enforce per-record ownership, per-company, or per-worksite access.
- Several public lookup endpoints still expose operational metadata for compatibility. They should be revisited after the frontend migrates fully to backend-owned sessions.
- `POST /signio/webhook` remains public for provider callbacks. It needs provider-level signature/token validation in a separate hardening change.

## Rollback by batch

1. **Admin batch rollback**: remove `authenticateSession` and admin permission middleware from admin route mounts in `index.js`.
2. **Worker/form batch rollback**: remove `authenticateSession` and actor-role middleware from `/compartido`, `/gruaman`, `/bomberman`, `/horas_jornada`, `/sst/pqr`, `POST /validar_ubicacion`, and `GET /trabajador_id`.
3. **Credential-management rollback**: remove scoped guards from `POST /auth/pin/set` and WebAuthn registration routes only if frontend migration is blocked. This reopens credential-enrollment risk and should be temporary.
4. **Signio admin rollback**: remove configured admin guards from non-webhook Signio routes while keeping `/signio/webhook` public.
