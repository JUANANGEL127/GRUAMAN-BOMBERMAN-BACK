import test from "node:test";
import assert from "node:assert/strict";
import { createFormatosObligatoriosEstadoService } from "../services/formatosObligatoriosEstadoService.js";

function createRepositoryStub(overrides = {}) {
  return {
    findWorkerByCedula: async () => ({ id: 1, nombre: "Operador Test", empresa_id: 1 }),
    findObraNombreById: async () => "Sede A",
    findLatestIngreso: async () => null,
    findLatestSalida: async () => null,
    findLatestByForm: async () => null,
    ...overrides
  };
}

test("returns all forms false when no records exist", async () => {
  const service = createFormatosObligatoriosEstadoService({ repository: createRepositoryStub() });

  const result = await service.getEstado({
    cedula_trabajador: "10203040",
    obra_id: 9,
    empresa_id: 5,
    fecha_servicio: "2026-05-22"
  });

  assert.equal(result.hora_ingreso.completado, false);
  assert.equal(result.permiso_trabajo.completado, false);
  assert.equal(result.chequeo_alturas.completado, false);
  assert.equal(result.planilla_bombeo.completado, false);
});

test("keeps deterministic id metadata when form exists", async () => {
  const service = createFormatosObligatoriosEstadoService({
    repository: createRepositoryStub({
      findLatestIngreso: async () => ({ id: 25, fecha_registro: "2026-05-22" }),
      findLatestByForm: async ({ table }) => (table === "permiso_trabajo" ? { id: 99, fecha_registro: "2026-05-22" } : null)
    })
  });

  const result = await service.getEstado({
    cedula_trabajador: "10203040",
    nombre_proyecto: "Sede A",
    fecha_servicio: "2026-05-22"
  });

  assert.equal(result.hora_ingreso.id, 25);
  assert.equal(result.permiso_trabajo.id, 99);
});

test("defaults date from client timestamp when fecha_servicio missing", async () => {
  let capturedDate = null;
  const service = createFormatosObligatoriosEstadoService({
    repository: createRepositoryStub({
      findLatestIngreso: async ({ fechaServicio }) => {
        capturedDate = fechaServicio;
        return null;
      }
    })
  });

  await service.getEstado({
    cedula_trabajador: "10203040",
    nombre_proyecto: "Sede A",
    fecha_cliente: "2026-05-22T14:00:00-05:00"
  });

  assert.equal(capturedDate, "2026-05-22");
});

test("throws 404 when worker does not exist", async () => {
  const service = createFormatosObligatoriosEstadoService({
    repository: createRepositoryStub({ findWorkerByCedula: async () => null })
  });

  await assert.rejects(
    () => service.getEstado({ cedula_trabajador: "000", nombre_proyecto: "Sede A" }),
    (error) => error?.status === 404
  );
});
