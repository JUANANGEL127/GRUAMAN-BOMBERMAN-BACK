# Configurable Temporal Motives Proposal

## Goal

Extend the temporal novelty model so HR can manage a configurable catalog of novelty types and motives instead of relying only on free-text reasons.

## Current state

The backend currently supports:

- a fixed temporal `tipo` axis with canonical values:
  - `vacaciones`
  - `permiso`
  - `sancion`
  - `incapacidad_at`
  - `incapacidad_general`
  - `licencia`
- a free-text `motivo`
- a stored `remunerada` value, with optional defaulting from motive/type configuration when omitted
- temporal records that do not overwrite permanent worker state
- soft-cancel metadata for annulled records while preserving history

This is valid for the initial implementation, but it does not provide business-managed configuration for HR, payroll, or reporting.

## Proposed model

Keep the canonical temporal type fixed, and add a configurable motive catalog.

### Canonical type

Keep `tipo` as the stable business axis:

- `vacaciones`
- `permiso`
- `sancion`
- `incapacidad_at`
- `incapacidad_general`
- `licencia`

### Configurable motive catalog

Introduce a catalog that defines the business reasons available for temporal records.

Recommended fields:

- `id`
- `codigo`
- `nombre`
- `tipo` (one of the canonical novelty values listed above)
- `remunerada_default` (`true` / `false`)
- `activo` (`true` / `false`)
- `orden`
- `created_at`
- `updated_at`

Optional fields if the business needs them later:

- `requiere_fecha_fin`
- `requiere_aprobacion`
- `observaciones`

### Temporal record shape

Temporal records should reference the catalog entry instead of storing only a free-text motive.

Recommended payload shape:

- `tipo`
- `motivo_id` for new catalog-backed records
- `motivo` remains for legacy/history compatibility and display fallbacks
- `remunerada` can be omitted and should default from the selected motive when possible
- `anular` should preserve the row and write cancellation metadata instead of deleting it
- `fecha_inicio`
- `fecha_fin`

## Why this model

This approach gives the business:

- controlled vocabulary for reports
- stable remuneration classification
- less inconsistent free-text data
- room to evolve the catalog without changing the permanent worker model

It also keeps the current architecture clean because:

- `trabajadores.activo` remains permanent
- temporal records remain additive history
- indicator-central exclusion still depends on the active temporal window

## Frontend impact

The UI should move from a free-text motive input to a controlled selector backed by the motive catalog.

Recommended UI behavior:

- show the canonical `tipo`
- let the user pick a motive from an active catalog list
- default remuneration from the selected motive when the backend allows omission
- display motive labels in list, detail, and history views
- preserve legacy free-text motive labels only for older records without a catalog reference

## Backend impact

The backend would need:

- a catalog table for motives
- admin CRUD or maintenance endpoints for the catalog
- validation that `motivo_id` belongs to an active motive compatible with the selected `tipo`
- route wiring for a motive catalog section that does not shadow temporal `/:id` routes
- migration logic to map existing free-text records into the new reference model, or a fallback compatibility path
- idempotent bootstrap DDL that preserves existing rows and adds audit columns for annulment

## Risks and tradeoffs

### Benefits

- better reporting
- cleaner HR workflows
- consistent remuneration logic

### Tradeoffs

- more backend and frontend work
- migration complexity if historical records need normalization
- catalog governance becomes a product responsibility

## Recommended rollout

1. Keep the current temporal implementation stable.
2. Add the motive catalog in the backend.
3. Update the temporal record form to use the catalog.
4. Migrate the frontend once the contract is stable.
5. Backfill or map legacy free-text motives only if reporting requires it.

## Acceptance criteria

- HR can configure active temporal motives without code changes.
- Temporal records can reference a motive catalog item.
- The UI shows the selected motive consistently in list, detail, and history.
- Remuneration classification stays explicit and auditable.
- The permanent worker state and indicator-central behavior remain unchanged.
- Annulled records remain queryable for audit and history.
