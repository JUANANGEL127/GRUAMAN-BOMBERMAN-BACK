import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerTemporalStateRepository } from "../repositories/workerTemporalStateRepository.js";

test("builds cutoff-aware active novelty lookup queries that ignore anulled and closed rows", async () => {
  let captured = null;
  const repository = createWorkerTemporalStateRepository({
    db: {
      query: async (sql, params) => {
        captured = { sql, params };
        return { rows: [] };
      }
    }
  });

  await repository.findCurrentTemporalStateByWorkerIdAtCutoff(1, "2026-06-17");

  assert.equal(captured.params[0], 1);
  assert.equal(captured.params[1], "2026-06-17");
  assert.match(captured.sql, /cerrado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /anulado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /fecha_inicio\s+<=\s+\$2::date/i);
  assert.doesNotMatch(captured.sql, /NOW\(\)/i);
});

test("builds cutoff-aware next novelty lookup queries that ignore anulled and closed rows", async () => {
  let captured = null;
  const repository = createWorkerTemporalStateRepository({
    db: {
      query: async (sql, params) => {
        captured = { sql, params };
        return { rows: [] };
      }
    }
  });

  await repository.findNextTemporalStateByWorkerIdAtCutoff(1, "2026-06-17");

  assert.equal(captured.params[0], 1);
  assert.equal(captured.params[1], "2026-06-17");
  assert.match(captured.sql, /cerrado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /anulado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /fecha_inicio\s+>\s+\$2::date/i);
  assert.doesNotMatch(captured.sql, /NOW\(\)/i);
});

test("overlap checks ignore annulled and closed rows", async () => {
  let captured = null;
  const repository = createWorkerTemporalStateRepository({
    db: {
      query: async (sql, params) => {
        captured = { sql, params };
        return { rows: [] };
      }
    }
  });

  await repository.hasOverlappingTemporalState({
    workerId: 1,
    fechaInicio: "2026-06-18",
    fechaFin: "2026-06-20"
  });

  assert.equal(captured.params[0], 1);
  assert.equal(captured.params[1], "2026-06-18");
  assert.equal(captured.params[2], "2026-06-20");
  assert.match(captured.sql, /cerrado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /anulado_at\s+IS\s+NULL/i);
  assert.match(captured.sql, /CURRENT_DATE/i);
});
