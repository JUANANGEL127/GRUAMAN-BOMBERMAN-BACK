import test from "node:test";
import assert from "node:assert/strict";
import { createAdminTemporalMotiveCatalogController } from "../controllers/adminTemporalMotiveCatalogController.js";

function createResponseStub() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("creates a motive catalog entry through the controller", async () => {
  let capturedPayload = null;
  const controller = createAdminTemporalMotiveCatalogController({
    service: {
      createTemporalMotive: async (payload) => {
        capturedPayload = payload;
        return { id: 31, ...payload };
      }
    }
  });

  const res = createResponseStub();
  await controller.createTemporalMotive({ body: { codigo: "LIC-03", nombre: "Licencia médica", tipo: "licencia", remunerada_default: true } }, res);

  assert.equal(capturedPayload.codigo, "LIC-03");
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.motivo.id, 31);
});

test("activates and deactivates motive catalog entries", async () => {
  const calls = [];
  const controller = createAdminTemporalMotiveCatalogController({
    service: {
      activateTemporalMotive: async (id) => {
        calls.push(["activate", id]);
        return { id, activo: true };
      },
      deactivateTemporalMotive: async (id) => {
        calls.push(["deactivate", id]);
        return { id, activo: false };
      }
    }
  });

  const activateRes = createResponseStub();
  const deactivateRes = createResponseStub();

  await controller.activateTemporalMotive({ params: { motiveId: "9" } }, activateRes);
  await controller.deactivateTemporalMotive({ params: { motiveId: "9" } }, deactivateRes);

  assert.deepEqual(calls, [["activate", 9], ["deactivate", 9]]);
  assert.equal(activateRes.body.motivo.activo, true);
  assert.equal(deactivateRes.body.motivo.activo, false);
});
