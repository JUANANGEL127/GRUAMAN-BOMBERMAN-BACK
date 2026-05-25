import { DateTime } from "luxon";

const BOGOTA_TIMEZONE = "America/Bogota";

const FORM_CATALOG = [
  { key: "hora_ingreso", type: "ingreso" },
  { key: "permiso_trabajo", table: "permiso_trabajo", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "hora_salida", type: "salida" },
  { key: "chequeo_alturas", table: "chequeo_alturas", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "chequeo_torregruas", table: "chequeo_torregruas", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "inspeccion_epcc", table: "inspeccion_epcc", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "inspeccion_izaje", table: "inspeccion_izaje", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "chequeo_elevador", table: "chequeo_elevador", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "ats", table: "ats", operatorColumn: "nombre_operador", projectColumn: "lugar_obra", dateColumn: "fecha_elaboracion" },
  { key: "planilla_bombeo", table: "planilla_bombeo", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "checklist", table: "checklist", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "inventario_obra", table: "inventario_obra", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "inspeccion_epcc_bomberman", table: "inspeccion_epcc_bomberman", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "herramientas_mantenimiento", table: "herramientas_mantenimiento", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "kit_limpieza", table: "kit_limpieza", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" },
  { key: "pqr", table: "pqr", operatorColumn: "nombre_operador", projectColumn: "nombre_proyecto", dateColumn: "fecha_servicio" }
];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeBogotaCalendarDate(rawQuery) {
  const byDate = typeof rawQuery?.fecha_servicio === "string" ? rawQuery.fecha_servicio.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(byDate)) {
    const dt = DateTime.fromFormat(byDate, "yyyy-MM-dd", { zone: BOGOTA_TIMEZONE });
    if (dt.isValid) return dt.toFormat("yyyy-MM-dd");
  }

  const source = rawQuery?.fecha_cliente ?? rawQuery?.timestamp_cliente;
  if (source !== undefined && source !== null && String(source).trim() !== "") {
    const numericTs = Number(source);
    const dt = Number.isFinite(numericTs)
      ? DateTime.fromMillis(numericTs, { zone: BOGOTA_TIMEZONE })
      : DateTime.fromISO(String(source), { zone: BOGOTA_TIMEZONE });
    if (dt.isValid) return dt.toFormat("yyyy-MM-dd");
  }

  return DateTime.now().setZone(BOGOTA_TIMEZONE).toFormat("yyyy-MM-dd");
}

function toEstado(row) {
  if (!row) return { completado: false };
  const fechaRegistro = DateTime.fromFormat(String(row.fecha_registro), "yyyy-MM-dd", { zone: BOGOTA_TIMEZONE });
  return {
    completado: true,
    id: row.id,
    fecha_registro: fechaRegistro.isValid
      ? fechaRegistro.startOf("day").toUTC().toISO({ suppressMilliseconds: true })
      : null
  };
}

export function createFormatosObligatoriosEstadoService({ repository }) {
  return {
    async getEstado(rawQuery) {
      const cedulaTrabajador = String(rawQuery?.cedula_trabajador || "").trim();
      const empresaId = parsePositiveInteger(rawQuery?.empresa_id);
      const obraId = parsePositiveInteger(rawQuery?.obra_id);
      const nombreProyectoRaw = String(rawQuery?.nombre_proyecto || "").trim();
      const fechaServicio = normalizeBogotaCalendarDate(rawQuery);

      if (!cedulaTrabajador) {
        throw createHttpError(400, "Parámetro obligatorio inválido: cedula_trabajador");
      }
      if (!obraId && !nombreProyectoRaw) {
        throw createHttpError(400, "Debes enviar obra_id o nombre_proyecto");
      }

      const worker = await repository.findWorkerByCedula({ cedulaTrabajador, empresaId });
      if (!worker) throw createHttpError(404, "No se encontró trabajador para la cédula enviada");

      const nombreProyecto = nombreProyectoRaw || await repository.findObraNombreById({ obraId });
      if (!nombreProyecto) {
        throw createHttpError(404, "No se encontró la obra para los filtros enviados");
      }

      const response = {};
      for (const form of FORM_CATALOG) {
        let row = null;
        if (form.type === "ingreso") {
          console.log({ nombreOperador: worker.nombre, nombreProyecto, fechaServicio });
          
          row = await repository.findLatestIngreso({ nombreOperador: worker.nombre, nombreProyecto, fechaServicio, empresaId });
        } else if (form.type === "salida") {
          row = await repository.findLatestSalida({ nombreOperador: worker.nombre, nombreProyecto, fechaServicio, empresaId });
        } else {
          row = await repository.findLatestByForm({
            table: form.table,
            operatorColumn: form.operatorColumn,
            projectColumn: form.projectColumn,
            dateColumn: form.dateColumn,
            nombreOperador: worker.nombre,
            nombreProyecto,
            fechaServicio,
            empresaId

          });
        }
        response[form.key] = toEstado(row);
      }

      return response;
    }
  };
}
