# Admin Users Temporal State Frontend PRD

This document defines the frontend product requirements for temporal novelties on workers.

## Purpose

Provide the UI with a stable contract to manage:

- permanent worker state (`activo`)
- temporal novelty state
- historical temporal records
- indicator-central exclusion while a temporal state is active

## Backend contract

### Backend rules

- `trabajadores.activo` remains the permanent worker status.
- Temporal records are additive history and do not overwrite `activo`.
- Active temporal records exclude the worker from the indicator central.
- Expired and annulled temporal records remain visible in history.
- Hours-extra flows remain unchanged and status-agnostic.
- Temporal motives are selected from a managed catalog with canonical `tipo` values:
  - `vacaciones`
  - `permiso`
  - `sancion`
  - `incapacidad_at`
  - `incapacidad_general`
  - `licencia`
- Legacy rows without a catalog reference still display their stored `motivo` label and audit snapshots when present.

### Routes

#### Get the temporal state timeline for one worker

`GET /admin_usuarios/estado-temporal/:id`

#### Response

```json
{
  "success": true,
  "trabajador": {
    "id": 123,
    "nombre": "Juan Pérez",
    "activo": true,
    "empresa_id": 1,
    "numero_identificacion": "10203040"
  },
  "estado_temporal_actual": {
    "id": 55,
    "trabajador_id": 123,
  "tipo": "sancion",
  "motivo": "Sanción RRHH",
  "remunerada": false,
  "anulado_at": null,
  "anulado_by": null,
  "anulado_motivo": null,
  "fecha_inicio": "2026-06-10",
  "fecha_fin": "2026-06-20",
  "vigente_hoy": true,
  "excluye_indicador_central": true
  },
  "estado_temporal_programado": null,
  "historial_estados_temporales": [],
  "vigente_hoy": true,
  "excluye_indicador_central": true
}
```

#### Create a temporal record

`POST /admin_usuarios/estado-temporal/:id`

#### Body

```json
{
  "tipo": "sancion",
  "motivo_id": 12,
  "fecha_inicio": "2026-06-10",
  "fecha_fin": "2026-06-20"
}
```

#### Validation

- `tipo` is required and must be one of the canonical novelty values listed above.
- `motivo_id` is required for new catalog-backed records and must reference an active motive compatible with `tipo`.
- `motivo` is preserved as free text when entered directly and is also stored as a snapshot for catalog-backed rows.
- `remunerada` is optional; when omitted, the backend defaults it from the selected motive's catalog setting or type default.
- `fecha_inicio` and `fecha_fin` are required and must be `YYYY-MM-DD`.
- `fecha_fin >= fecha_inicio`.
- overlapping temporal records for the same worker are rejected with `409`.
- `anular` preserves the row and adds cancellation metadata instead of deleting history.

#### Catalog motive label behavior

- New records return the selected catalog motive label in `motivo`.
- Historical records without a catalog reference keep showing their stored free-text `motivo`.
- The detail/history payload may also include catalog snapshot fields such as `motivo_catalogo_id` and snapshot labels for auditability.
- Annulled records stay visible in history with `anulado_at`, `anulado_by`, and `anulado_motivo`.

#### Update a temporal record

`PATCH /admin_usuarios/estado-temporal/:id/:estadoTemporalId`

Use this to correct any subset of fields: dates, motivo, type, or remuneration classification.
The frontend must treat this as a partial update, not as a full replacement payload.

#### Close a temporal record early

`POST /admin_usuarios/estado-temporal/:id/:estadoTemporalId/cerrar`

Closing is now a separate status from the novelty period:

- `fecha_inicio` and `fecha_fin` continue to represent the business period of the novelty.
- The close action marks the record with `cerrado_at` / `cerrado_by`.
- The backend does **not** reuse `fecha_fin` as the closed flag.
- The frontend does not need to send `fecha_fin` to close a record.

### Worker list contract

`GET /admin_usuarios/listar` returns each worker with:

- `activo`
- `estado_temporal_actual`
- `tiene_estado_temporal_activo`
- `excluye_indicador_central`

The frontend should use those flags to render the current badge without making extra requests.
Only records that are **vigente hoy** should affect these list badges. Scheduled future records must **not** be rendered as active exclusion yet.

## 1) UI objectives and scope

The UI must let admins understand, create, review, edit, and close temporal states without confusing them with permanent worker activation.

### Scope

- Show permanent worker status and temporal worker status as separate concepts.
- Surface current temporal state, scheduled temporal state, and historical records.
- Make indicator-central exclusion visible anywhere the worker appears.
- Support create, update, and early-close flows for temporal records.
- Show temporal motive labels from the catalog when available, and legacy labels otherwise.

### Out of scope

- Changing `trabajadores.activo` from the temporal-state UI.
- Editing hours-extra behavior.
- Deleting expired temporal history.

## 2) User management screens and flows

### Worker list

- Show a permanent status badge based on `activo`.
- Show a separate temporal badge based on `estado_temporal_actual` or `tiene_estado_temporal_activo`.
- If a worker is temporarily excluded, show that exclusion explicitly in the row, not only in a tooltip.
- The list must not imply that temporal state is the same as permanent inactive state.
- Scheduled future records should not mark the worker as currently excluded in the list view.

### Worker detail

- Show two clearly separated blocks:
  1. Permanent worker state
  2. Temporal state timeline
- The temporal block must include:
  - current state, if any
  - scheduled next state, if any
  - historical records
- Render the timeline in three groups:
  1. current temporal record
  2. next scheduled temporal record
  3. remaining timeline history
- Provide a clear action area for:
  - create temporal record
  - edit current or scheduled record when allowed
  - close current record early when allowed

### Create temporal record flow

- The action must be framed as "Create temporal state", not "Deactivate worker".
- Default copy should explain that the worker remains permanently active/inactive according to `activo`.
- Before submit, the form should explain whether the new record will exclude the worker from the indicator central.

### Edit temporal record flow

- Editing is for an existing temporal record only.
- Do not present editing as toggling worker activation.
- Preserve the record identity and timeline semantics.

### Close temporal record flow

- Closing a record means marking it as closed, not mutating its business period.
- The record may already have a `fecha_fin`; that does not prevent closing it.
- The UI may still offer "close today" as a shortcut, but the backend should treat closure as status only.
- Once closed, the record should move visually into history.

## 3) State model in the UI

### Permanent active/inactive

- `activo = true` means the worker is permanently active.
- `activo = false` means the worker is permanently inactive.
- This state is independent from any temporal state.

### Temporary active/scheduled/expired/history

Use the canonical fields below:

- `estado_temporal_actual`
- `estado_temporal_programado`
- `historial_estados_temporales`
- `vigente_hoy`
- `excluye_indicador_central`

Recommended UI interpretation:

- **Current temporary state**: `estado_temporal_actual != null`
- **Scheduled temporary state**: `estado_temporal_programado != null`
- **History**: items in `historial_estados_temporales`
- **Active today**: `vigente_hoy === true`
- **Indicator exclusion active today**: `excluye_indicador_central === true`
- **Future scheduled state**: `estado_temporal_programado != null`

The list view should only surface the current badge and the exclusion flag for states that are active today. Scheduled records are visible in detail, not as current exclusion.

### Timeline presentation

- Current state and scheduled state should appear above history.
- History should be read-only unless the backend explicitly supports editing that record.
- Do not collapse future and past states into one undifferentiated list if the UI can separate them.

## 4) Required fields and field-level validation

### Required fields for create

- `tipo`
- `motivo`
- `fecha_inicio`
- `fecha_fin`

### Required / optional fields for edit

- Edit can send **any subset** of the same fields.
- If no field is sent, the backend returns `400`.

### Field-level validation

- `tipo`
  - Allowed values: `vacaciones`, `permiso`, `sancion`, `incapacidad_at`, `incapacidad_general`, `licencia`
  - Show a human-readable label, but submit the canonical value.
- `motivo`
  - Required.
  - Trim whitespace before submit.
  - Do not allow an empty string after trimming.
- `remunerada`
  - Optional boolean for create; when omitted the backend may default it from the motive catalog or type configuration, but it is always stored and returned.
  - Render as an explicit yes/no control.
- `fecha_inicio`
  - Required.
  - Must be a valid `YYYY-MM-DD` value.
  - Must be in the same timezone interpretation as the backend business date, not the browser clock alone.
- `fecha_fin`
  - Required on create.
  - Must be a valid `YYYY-MM-DD` value.
  - Must be greater than or equal to `fecha_inicio`.

### API error handling to show in the form

- `400`: invalid or missing field
- `404`: worker or temporal record not found
- `409`: overlapping range, already closed, or unsupported edit of closed record

## 5) Display rules for reason, remuneration, dates, and badges

### Reason

- Always show `motivo` in detail and history.
- In list rows, show the reason only when space allows; otherwise keep it in a secondary line or drawer.

### Remuneration

- Show a badge or chip for remunerated vs non-remunerated.
- Use plain language:
  - "Paid"
  - "Unpaid"
- The badge must be visually distinct from permanent active/inactive status.

### Dates

- Display dates in a consistent UI format, but store/send as `YYYY-MM-DD`.
- Show both start and end dates for current, scheduled, and historical states.
- If a record is still open, show an explicit "Open" or "Until today" style label depending on the actual payload.

### Badges

Use separate badges for:

- permanent worker status
- temporal state type
- temporal state activity today
- indicator-central exclusion

### Badge copy guidance

- Permanent active: "Active"
- Permanent inactive: "Inactive"
- Current temporal state: "Temporary state"
- Scheduled temporal state: "Scheduled"
- Expired/history: "History"
- Excluded from indicator central: "Excluded from indicator central"

## 6) How the frontend should interpret `vigente_hoy` and `excluye_indicador_central`

These two fields are canonical server signals and should be treated as source of truth.

- `vigente_hoy = true`
  - The temporal record is active for today in the business timezone.
  - The UI should highlight it as the effective current temporary state.
- `excluye_indicador_central = true`
  - The worker must be excluded from the indicator central.
  - The UI must show this explicitly and prominently wherever worker status appears.

### Important rule

Do not recompute these flags in the browser using local timezone logic if the backend already provided them. Use the backend values as authoritative.

## Assumptions

- The list view will not receive `estado_temporal_programado` or `historial_estados_temporales` from `GET /admin_usuarios/listar`; the frontend should open the detail view to inspect the full timeline.
- The UI may keep a local refresh after create/update/close actions so the list and detail stay in sync, because the mutation endpoints return the updated record but not the full timeline.
- Historical records are rendered as read-only unless the backend later exposes an explicit edit action for that specific record.

## 7) Manual verification checklist for frontend implementation

1. Open the worker list and confirm permanent status and temporal status are visually separate.
2. Open a permanently active worker with no temporal record and confirm no temporary badge is shown.
3. Open a worker with an active temporal record and confirm the worker is visibly marked as excluded from the indicator central.
4. Open a worker with a scheduled temporal record and confirm it appears separately from history.
5. Create a temporal record and confirm the UI does not frame it as changing `activo`.
6. Submit invalid dates or a missing reason and confirm field-level validation blocks the request.
7. Attempt overlapping dates and confirm the UI shows the backend `409` error clearly.
8. Close a current temporal record early and confirm it moves into history after refresh.
9. Test a boundary case near the day change in `America/Bogota` and confirm the default close date matches backend business time.
10. Confirm permanent inactive workers remain visually distinct from temporary exclusion.
11. Confirm the hours-extra screens remain unchanged by the temporal-state flow.

## 8) Rollout / dependency notes for frontend

- This PRD depends on the backend contract already implemented in `admin_usuarios` routes.
- No new backend routes are required for the initial frontend rollout.
- The frontend should prefer the existing list endpoint for row badges and the detail endpoint for timeline rendering.
- If the UI caches worker rows, it must invalidate or refresh after any temporal mutation.
- When migrating screens incrementally, prioritize:
  1. list row status badges
  2. worker detail timeline
  3. create/edit/close actions
- After create/edit/close, the frontend must refetch the worker detail timeline and the worker list row so the current badge and timeline stay in sync.

## 9) Explicit non-goals

- Do not use the temporal-state UI to change `trabajadores.activo`.
- Do not hide the permanent worker state behind the temporal state.
- Do not delete historical temporal records on expiration.
- Do not change hours-extra behavior.
- Do not invent new backend fields or routes to compensate for missing UI logic.
- Do not recompute server truth in the browser when the backend already provides it.
