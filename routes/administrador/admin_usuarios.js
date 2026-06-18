import express from "express";
import { createWorkerTemporalStateRepository } from "../../repositories/workerTemporalStateRepository.js";
import { createWorkerTemporalStateService } from "../../services/workerTemporalStateService.js";
import { createAdminWorkerTemporalStateController } from "../../controllers/adminWorkerTemporalStateController.js";
import { createTemporalMotiveCatalogRepository } from "../../repositories/temporalMotiveCatalogRepository.js";
import { createTemporalMotiveCatalogService } from "../../services/temporalMotiveCatalogService.js";
import { createAdminTemporalMotiveCatalogController } from "../../controllers/adminTemporalMotiveCatalogController.js";

function createPoolFactory(pool = null) {
  return () => pool || global.db;
}

function createDefaultDependencies() {
  const temporalStateRepository = createWorkerTemporalStateRepository({ db: createPoolFactory() });
  const temporalMotiveRepository = createTemporalMotiveCatalogRepository({ db: createPoolFactory() });

  const temporalStateService = createWorkerTemporalStateService({
    repository: temporalStateRepository,
    motiveCatalogRepository: temporalMotiveRepository
  });
  const temporalMotiveService = createTemporalMotiveCatalogService({ repository: temporalMotiveRepository });

  return {
    temporalStateRepository,
    temporalStateService,
    temporalStateController: createAdminWorkerTemporalStateController({ service: temporalStateService }),
    temporalMotiveRepository,
    temporalMotiveService,
    temporalMotiveController: createAdminTemporalMotiveCatalogController({ service: temporalMotiveService })
  };
}

export function createAdminUsuariosRouter(overrides = {}) {
  const {
    temporalStateRepository,
    temporalStateService,
    temporalStateController,
    temporalMotiveRepository,
    temporalMotiveService,
    temporalMotiveController
  } = {
    ...createDefaultDependencies(),
    ...overrides
  };

  const router = express.Router();

  async function enrichWorkersWithTemporalState(workers = []) {
    if (!Array.isArray(workers) || workers.length === 0) {
      return workers;
    }

    const activeTemporalMap = await temporalStateService.listTemporalStatesForWorkers(
      workers.map((worker) => worker.id)
    );

    return workers.map((worker) => {
      const temporal = activeTemporalMap.get(Number(worker.id)) || null;
      return {
        ...worker,
        estado_temporal_actual: temporal,
        tiene_estado_temporal_activo: temporal != null,
        excluye_indicador_central: temporal != null
      };
    });
  }

  /**
   * GET /admin_usuarios/listar
   * Retorna una lista paginada y opcionalmente filtrada de trabajadores para una empresa dada.
   * Incluye el estado temporal vigente para que el frontend pueda mostrar badges sin hacer requests adicionales.
   * @query {number} [empresa_id=1]
   * @query {number} [offset=0]
   * @query {number} [limit=10]
   * @query {string} [busqueda] - Coincidencia parcial sin distinción de mayúsculas en `nombre`.
   * @returns {{ success: boolean, total: number, trabajadores: Array }}
   */
  router.get("/listar", async (req, res) => {
    try {
      const pool = global.db;
      const { empresa_id = 1, offset = 0, limit = 10, busqueda = "" } = req.query;
      let where = "WHERE empresa_id = $1";
      const values = [empresa_id];

      if (busqueda) {
        where += " AND LOWER(nombre) LIKE $2";
        values.push(`%${busqueda.toLowerCase()}%`);
      }

      const q = await pool.query(
        `SELECT id, nombre, empresa_id, numero_identificacion, activo, pin_habilitado
           FROM trabajadores
          ${where}
          ORDER BY id DESC
          LIMIT $${values.length + 1}
         OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      );

      const totalQ = await pool.query(
        `SELECT COUNT(*)
           FROM trabajadores
          WHERE empresa_id = $1${busqueda ? " AND LOWER(nombre) LIKE $2" : ""}`,
        busqueda ? [empresa_id, `%${busqueda.toLowerCase()}%`] : [empresa_id]
      );

      const trabajadores = await enrichWorkersWithTemporalState(q.rows);
      return res.json({ success: true, total: Number(totalQ.rows[0].count), trabajadores });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /admin_usuarios/agregar
   * Crea un nuevo registro de trabajador.
   * @body {{ nombre: string, empresa_id: number, numero_identificacion: string, activo?: boolean }}
   * @returns {{ success: boolean, trabajador: object }}
   * @throws {400} Si faltan campos obligatorios.
   */
  router.post("/agregar", async (req, res) => {
    try {
      const pool = global.db;
      const { nombre, empresa_id, numero_identificacion, activo } = req.body;
      if (!nombre || !empresa_id || !numero_identificacion) {
        return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
      }
      const q = await pool.query(
        `INSERT INTO trabajadores (nombre, empresa_id, numero_identificacion, activo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre, empresa_id, numero_identificacion, activo`,
        [nombre, empresa_id, numero_identificacion, !!activo]
      );
      return res.json({ success: true, trabajador: q.rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PATCH /admin_usuarios/estado/:id
   * Alterna el estado activo/inactivo de un trabajador.
   * @param {string} id - ID del trabajador.
   * @body {{ activo: boolean }}
   * @returns {{ success: boolean, trabajador: { id, nombre, activo } }}
   * @throws {400} Si `activo` no es booleano.
   * @throws {404} Si el trabajador no existe.
   */
  router.patch("/estado/:id", async (req, res) => {
    try {
      const pool = global.db;
      const { id } = req.params;
      const { activo } = req.body;
      if (typeof activo !== "boolean") {
        return res.status(400).json({ success: false, error: "activo debe ser booleano" });
      }
      const q = await pool.query(
        `UPDATE trabajadores
            SET activo = $1
          WHERE id = $2
          RETURNING id, nombre, activo`,
        [activo, id]
      );
      if (q.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Trabajador no encontrado" });
      }
      return res.json({ success: true, trabajador: q.rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PATCH /admin_usuarios/pin/:id
   * Habilita o deshabilita la autenticación por PIN para un trabajador.
   * Al deshabilitar, el hash del PIN almacenado se limpia para que el trabajador deba crear uno nuevo si se rehabilita.
   * @param {string} id - ID del trabajador.
   * @body {{ pin_habilitado: boolean }}
   * @returns {{ success: boolean, trabajador: { id, nombre, pin_habilitado } }}
   * @throws {400} Si `pin_habilitado` no es booleano.
   * @throws {404} Si el trabajador no existe.
   */
  router.patch("/pin/:id", async (req, res) => {
    try {
      const pool = global.db;
      const { id } = req.params;
      const { pin_habilitado } = req.body;
      if (typeof pin_habilitado !== "boolean") {
        return res.status(400).json({ success: false, error: "pin_habilitado debe ser booleano" });
      }
      const q = await pool.query(
        `UPDATE trabajadores
            SET pin_habilitado = $1,
                pin_hash = CASE WHEN $1 = false THEN NULL ELSE pin_hash END
          WHERE id = $2
          RETURNING id, nombre, pin_habilitado`,
        [pin_habilitado, id]
      );
      if (q.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Trabajador no encontrado" });
      }
      return res.json({ success: true, trabajador: q.rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get("/temporal-motivos", temporalMotiveController.listTemporalMotives);
  router.post("/temporal-motivos", temporalMotiveController.createTemporalMotive);
  router.patch("/temporal-motivos/:motiveId", temporalMotiveController.updateTemporalMotive);
  router.post("/temporal-motivos/:motiveId/activar", temporalMotiveController.activateTemporalMotive);
  router.post("/temporal-motivos/:motiveId/desactivar", temporalMotiveController.deactivateTemporalMotive);

  router.get("/estado-temporal/:id", temporalStateController.getTemporalState);
  router.post("/estado-temporal/:id", temporalStateController.createTemporalState);
  router.patch("/estado-temporal/:id/:estadoTemporalId", temporalStateController.updateTemporalState);
  router.post("/estado-temporal/:id/:estadoTemporalId/cerrar", temporalStateController.closeTemporalState);
  if (typeof temporalStateController.anularTemporalState === "function") {
    router.post("/estado-temporal/:id/:estadoTemporalId/anular", temporalStateController.anularTemporalState);
  }

  return router;
}

const defaultRouter = createAdminUsuariosRouter();
export default defaultRouter;
