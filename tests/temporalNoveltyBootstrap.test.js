import test from "node:test";
import assert from "node:assert/strict";
import { buildTemporalNoveltyBootstrapStatements } from "../helpers/temporal_novelty_bootstrap.js";

test("bootstrap DDL includes canonical novelty types and audit columns", () => {
  const ddl = buildTemporalNoveltyBootstrapStatements().join("\n");

  for (const tipo of [
    "vacaciones",
    "permiso",
    "sancion",
    "incapacidad_at",
    "incapacidad_general",
    "licencia"
  ]) {
    assert.match(ddl, new RegExp(tipo));
  }

  assert.match(ddl, /anulado_at TIMESTAMPTZ/i);
  assert.match(ddl, /anulado_by INT/i);
  assert.match(ddl, /anulado_motivo TEXT/i);
  assert.match(ddl, /cerrado_at TIMESTAMPTZ/i);
  assert.match(ddl, /cerrado_by INT/i);
  assert.match(ddl, /DROP CONSTRAINT IF EXISTS trabajador_estado_temporal_tipo_check/i);
  assert.match(ddl, /ADD CONSTRAINT trabajador_estado_temporal_tipo_check CHECK/i);
  assert.match(ddl, /DROP CONSTRAINT IF EXISTS trabajador_estado_temporal_no_overlap/i);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS/i);
  assert.doesNotMatch(ddl, /DROP TABLE/i);
});
