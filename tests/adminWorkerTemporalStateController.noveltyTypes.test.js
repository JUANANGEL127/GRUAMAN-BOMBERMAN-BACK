import test from "node:test";
import assert from "node:assert/strict";
import { createAdminWorkerTemporalStateController } from "../controllers/adminWorkerTemporalStateController.js";

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

test("anular endpoint delegates to the service and returns preserved history", async () => {
  let captured = null;
  const controller = createAdminWorkerTemporalStateController({
    service: {
      anularTemporalState: async (workerId, recordId, payload, cancelledBy) => {
        captured = { workerId, recordId, payload, cancelledBy };
        return { id: recordId, anulado_at: "2026-06-17T10:00:00Z" };
      }
    }
  });

  const res = createResponseStub();
  await controller.anularTemporalState({
    params: { id: "1", estadoTemporalId: "21" },
    body: { motivo_anulacion: "Error de carga" },
    auth: { user: { adminId: 77 } }
  }, res);

  assert.deepEqual(captured, {
    workerId: 1,
    recordId: 21,
    payload: { motivo_anulacion: "Error de carga" },
    cancelledBy: 77
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.estado_temporal.anulado_at, "2026-06-17T10:00:00Z");
});

test("unexpected errors are logged before returning the generic 500 response", async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => {
    logs.push(args);
  };

  try {
    const controller = createAdminWorkerTemporalStateController({
      service: {
        createTemporalState: async () => {
          throw new Error("boom");
        }
      }
    });

    const res = createResponseStub();
    await controller.createTemporalState({
      params: { id: "1" },
      body: {
        tipo: "vacaciones",
        motivo: "anl",
        fecha_inicio: "2026-06-18",
        fecha_fin: "2026-06-20",
        remunerada: true
      },
      auth: { user: { id: 7 } }
    }, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "Error interno procesando estado temporal del trabajador");
    assert.ok(logs.length >= 1);
    assert.equal(logs[0][0], "[adminWorkerTemporalStateController]");
    assert.equal(logs[0][1].message, "boom");
  } finally {
    console.error = originalConsoleError;
  }
});

test("close endpoint forwards the authenticated user as the closer and returns success", async () => {
  let captured = null;
  const controller = createAdminWorkerTemporalStateController({
    service: {
      closeTemporalState: async (workerId, recordId, payload, closedBy) => {
        captured = { workerId, recordId, payload, closedBy };
        return { id: recordId, cerrado_at: "2026-06-18T12:00:00.000Z", cerrado_by: closedBy };
      }
    }
  });

  const res = createResponseStub();
  await controller.closeTemporalState({
    params: { id: "1", estadoTemporalId: "21" },
    body: {},
    auth: { user: { adminId: 77 } }
  }, res);

  assert.deepEqual(captured, {
    workerId: 1,
    recordId: 21,
    payload: {},
    closedBy: 77
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.estado_temporal.cerrado_by, 77);
});

test("temporal overlap database errors are translated to a 409 response", async () => {
  const controller = createAdminWorkerTemporalStateController({
    service: {
      createTemporalState: async () => {
        const error = new Error("conflicting key value violates exclusion constraint");
        error.code = "23P01";
        throw error;
      }
    }
  });

  const res = createResponseStub();
  await controller.createTemporalState({
    params: { id: "1" },
    body: {
      tipo: "licencia",
      motivo: "anl",
      fecha_inicio: "2026-06-18",
      fecha_fin: "2026-06-20",
      remunerada: true
    },
    auth: { user: { id: 7 } }
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /superpone/i);
});
