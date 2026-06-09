# Geolocation hardening for attendance (backend)

## What changed

### 1) New persistent audit tables
- `auth_session_location_contexts`
  - Stores the latest validated location context for each auth session.
  - Tracks `session_id`, `worker_id`, `obra_id`, coordinates, distance, validation source, ip, user-agent.
- `attendance_location_audit_logs`
  - Immutable audit log for geolocation-sensitive events.
  - Stores event/action (`allowed`, `denied`, `error`), message, coords, distance, payload, session, worker, obra, ip, user-agent.

### 2) Session start location capture
- `POST /auth/pin/verify` now accepts optional:
  - `obra_id`, `lat`, `lon`, `accuracy_meters`
- If provided, backend validates location against obra radius and logs event `session_start_location`.
- If validation is successful, backend stores session context in `auth_session_location_contexts`.
- If location is missing, it still logs an `error` audit record (no hard block at login).

### 3) `/validar_ubicacion` now logs and persists session context
- Keeps previous functional behavior (`ok: true` or blocked by distance).
- Every attempt writes audit log `session_location_validation`.
- Successful validations upsert session context for later attendance decisions.

### 4) `/horas_jornada/salida` is now geolocation-aware and audited
- Adds security checks and telemetry:
  - Worker cannot close another operator's record.
  - Requires `lat` and `lon` in payload.
  - Resolves obra from (priority):
    1. `obra_id` from payload
    2. session context from `auth_session_location_contexts`
    3. `nombre_proyecto` from pending `horas_jornada` row
  - Validates distance against obra coordinates and configured radius.
  - Logs every attempt (`allowed`/`denied`) with reason and metadata.

## Env/config
- `ATTENDANCE_GEO_MAX_DISTANCE_METERS` (default `500`)
- `OBRA_BYPASS_NOMBRE` (default `LA CENTRAL`)

## Request contract updates

### POST `/horas_jornada/salida`
Body now expected to include:
- `nombre_operador` (string)
- `fecha_servicio` (YYYY-MM-DD)
- `hora_salida` (HH:mm)
- `lat` (number)
- `lon` (number)
- `accuracy_meters` (optional number)
- `obra_id` (optional but recommended number)

## Operational value
- Traceable evidence for overtime disputes.
- Clear forensic reconstruction of:
  - where session context was established,
  - where exit-mark attempts happened,
  - whether each attempt was inside/outside allowed obra range.
