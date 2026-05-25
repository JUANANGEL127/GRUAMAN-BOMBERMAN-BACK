# Formatos obligatorios estado — manual edge-case checklist

## Scope

This checklist validates edge behavior for `GET /formatos_obligatorios/estado`:
- no records
- duplicates
- out-of-date rows
- worker without obra

## Preconditions

1. API is running locally.
2. Target worker exists in `trabajadores` and has `numero_identificacion`.
3. Use a deterministic test date (example: `2026-05-22`).
4. Use valid `obra_id` and `empresa_id` for the worker unless the scenario says otherwise.

## 1) No records => all sections false

1. Ensure there are no `horas_jornada` or `permiso_trabajo` rows for the worker/date scope.
2. Call:

```bash
curl --request GET "http://localhost:3000/formatos_obligatorios/estado?cedula_trabajador=10203040&obra_id=9&empresa_id=5&fecha_servicio=2026-05-22"
```

Expected:
- HTTP `200`
- `hora_ingreso.completado === false`
- `permiso_trabajo.completado === false`
- `hora_salida.completado === false`

## 2) Duplicates => deterministic winner (highest id fallback)

1. Insert duplicate same-day records for each section in `horas_jornada` and `permiso_trabajo`.
2. Keep at least two rows with increasing `id`.
3. Call the same endpoint.

Expected:
- HTTP `200`
- each section resolves to the latest deterministic row
- idempotent read: repeated calls return identical winner IDs for same DB state

## 3) Out-of-date rows are ignored

1. Insert rows for the same worker but different `fecha_servicio` (example: `2026-05-21`).
2. Query with `fecha_servicio=2026-05-22`.

Expected:
- HTTP `200`
- sections with only out-of-date rows return `{ completado: false, formato_id: null, fecha_registro: null }`

## 4) Worker without obra => not found scope

1. Use a worker with `obra_id IS NULL` (or no matching worker/obra scope).
2. Call endpoint with any `obra_id`.

Expected:
- HTTP `404`
- error payload indicates unresolved worker/project/company scope

## Automated scaffold tests

This repository now includes `tests/formatos_obligatorios_estado.test.js` using `node:test` with mocked worker and formatos repositories.

Run:

```bash
npm test
```
