import test from "node:test";
import assert from "node:assert/strict";
import { createTemporalMotiveCatalogRepository } from "../repositories/temporalMotiveCatalogRepository.js";

function createRepository(dbQuery) {
  return createTemporalMotiveCatalogRepository({
    db: {
      query: dbQuery
    }
  });
}

test("findDefaultTemporalMotiveByTipo resolves the active default permiso motive", async () => {
  let captured = null;
  const repository = createRepository(async (sql, params) => {
    captured = { sql, params };
    return {
      rows: [
        {
          id: 91,
          codigo: "PER-DEFAULT",
          nombre: "Permiso default",
          tipo: "permiso",
          remunerada_default: true,
          activo: true,
          orden: 1
        }
      ]
    };
  });

  const result = await repository.findDefaultTemporalMotiveByTipo("permiso");

  assert.equal(captured.params[0], "permiso");
  assert.equal(result.tipo, "permiso");
  assert.equal(result.remunerada_default, true);
});

test("findDefaultTemporalMotiveByTipo resolves the active default licencia motive", async () => {
  let captured = null;
  const repository = createRepository(async (sql, params) => {
    captured = { sql, params };
    return {
      rows: [
        {
          id: 92,
          codigo: "LIC-DEFAULT",
          nombre: "Licencia default",
          tipo: "licencia",
          remunerada_default: false,
          activo: true,
          orden: 2
        }
      ]
    };
  });

  const result = await repository.findDefaultTemporalMotiveByTipo("licencia");

  assert.equal(captured.params[0], "licencia");
  assert.equal(result.tipo, "licencia");
  assert.equal(result.remunerada_default, false);
});

test("findDefaultTemporalMotiveByTipo resolves the active canonical row without hard-filtering remunerada_default", async () => {
  let captured = null;
  const repository = createRepository(async (sql, params) => {
    captured = { sql, params };
    return {
      rows: [
        {
          id: 93,
          codigo: "LIC-ALT",
          nombre: "Licencia alternativa",
          tipo: "licencia",
          remunerada_default: false,
          activo: true,
          orden: 3
        }
      ]
    };
  });

  const result = await repository.findDefaultTemporalMotiveByTipo("licencia");

  assert.equal(captured.params[0], "licencia");
  assert.match(captured.sql, /WHERE tipo = \$1/i);
  assert.match(captured.sql, /AND activo = true/i);
  assert.match(captured.sql, /ORDER BY COALESCE\(orden, 999999\) ASC, id ASC/i);
  assert.doesNotMatch(captured.sql, /remunerada_default\s*=\s*true/i);
  assert.equal(result.id, 93);
  assert.equal(result.remunerada_default, false);
});
