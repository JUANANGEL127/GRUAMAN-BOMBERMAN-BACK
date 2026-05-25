function getDbClient(dbOrFactory) {
  if (typeof dbOrFactory === "function") {
    const resolvedDb = dbOrFactory();
    if (!resolvedDb) throw new Error("DB no disponible");
    return resolvedDb;
  }
  if (!dbOrFactory) throw new Error("DB no disponible");
  return dbOrFactory;
}

const ALLOWED_TABLES = new Set([
  "horas_jornada",
  "permiso_trabajo",
  "chequeo_alturas",
  "chequeo_torregruas",
  "inspeccion_epcc",
  "inspeccion_izaje",
  "chequeo_elevador",
  "ats",
  "planilla_bombeo",
  "checklist",
  "inventario_obra",
  "inspeccion_epcc_bomberman",
  "herramientas_mantenimiento",
  "kit_limpieza",
  "pqr"
]);
const TABLES_WITHOUT_EMPRESA_ID = new Set(["pqr"]);

const ALLOWED_TEXT_COLUMNS = new Set(["nombre_operador", "nombre", "nombre_proyecto", "lugar_obra"]);
const ALLOWED_DATE_COLUMNS = new Set(["fecha_servicio", "fecha_elaboracion"]);

export function createFormatosObligatoriosEstadoRepository({ db }) {
  function query(text, params) {
    const client = getDbClient(db);
    return client.query(text, params);
  }

  return {
    async findWorkerByCedula({ cedulaTrabajador, empresaId }) {
      const values = [cedulaTrabajador];
      let whereEmpresa = "";
      if (Number.isInteger(empresaId) && empresaId > 0) {
        values.push(empresaId);
        whereEmpresa = ` AND empresa_id = $${values.length}`;
      }

      const result = await query(
        `SELECT id, nombre, numero_identificacion, obra_id, empresa_id
         FROM trabajadores
         WHERE numero_identificacion = $1
         ${whereEmpresa}
         LIMIT 1`,
        values
      );

      return result.rows[0] || null;
    },

    async findObraNombreById({ obraId }) {
      const values = [obraId];
      
      
      const result = await query(
        `SELECT nombre_obra
         FROM obras
         WHERE id = $1
         LIMIT 1`,
        values
      );
      
      return result.rows[0]?.nombre_obra || null;
    },

    async findLatestByForm({ table, operatorColumn, projectColumn, dateColumn, nombreOperador, nombreProyecto, fechaServicio, empresaId }) {
      if (!ALLOWED_TABLES.has(table)) throw new Error(`Tabla no permitida: ${table}`);
      if (!ALLOWED_TEXT_COLUMNS.has(operatorColumn)) throw new Error(`Columna no permitida: ${operatorColumn}`);
      if (!ALLOWED_TEXT_COLUMNS.has(projectColumn)) throw new Error(`Columna no permitida: ${projectColumn}`);
      if (!ALLOWED_DATE_COLUMNS.has(dateColumn)) throw new Error(`Columna no permitida: ${dateColumn}`);

      const hasEmpresaFilter =
        Number.isInteger(empresaId) &&
        empresaId > 0 &&
        !TABLES_WITHOUT_EMPRESA_ID.has(table);
      const empresaClause = hasEmpresaFilter ? ` AND empresa_id = $4` : "";
      const params = hasEmpresaFilter
        ? [nombreOperador, nombreProyecto, fechaServicio, empresaId]
        : [nombreOperador, nombreProyecto, fechaServicio];

      const result = await query(
        `SELECT id, TO_CHAR(${dateColumn}, 'YYYY-MM-DD') AS fecha_registro
         FROM ${table}
         WHERE ${operatorColumn} = $1
           AND ${projectColumn} = $2
           AND ${dateColumn} = $3::date
           ${empresaClause}
         ORDER BY id DESC
         LIMIT 1`,
        params
      );

      return result.rows[0] || null;
    },

    async findLatestIngreso({ nombreOperador, nombreProyecto, fechaServicio, empresaId }) {
      const result = await query(
        `SELECT id, TO_CHAR(fecha_servicio, 'YYYY-MM-DD') AS fecha_registro
         FROM horas_jornada
         WHERE nombre_operador = $1
           AND nombre_proyecto = $2
           AND fecha_servicio = $3::date
           And empresa_id = $4
           AND hora_ingreso IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
        [nombreOperador, nombreProyecto, fechaServicio, empresaId]
      );
      return result.rows[0] || null;
    },

    async findLatestSalida({ nombreOperador, nombreProyecto, fechaServicio, empresaId }) {
      const result = await query(
        `SELECT id, TO_CHAR(fecha_servicio, 'YYYY-MM-DD') AS fecha_registro
         FROM horas_jornada
         WHERE nombre_operador = $1
           AND nombre_proyecto = $2
           AND fecha_servicio = $3::date
           AND empresa_id = $4
           AND hora_salida IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
        [nombreOperador, nombreProyecto, fechaServicio, empresaId]
      );
      return result.rows[0] || null;
    }
  };
}
