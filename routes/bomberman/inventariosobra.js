import { Router } from "express";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
import { formatDateOnly } from '../../helpers/dateUtils.js';
const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

/**
 * Convierte un valor a entero no negativo, usando 0 como valor predeterminado para entradas vacías o nulas.
 * @param {*} val
 * @returns {number}
 */
function normalizeInteger(val) {
  if (val === undefined || val === null || val === '') return 0;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Convierte un valor a una cadena sin espacios en los extremos, retornando cadena vacía para null/undefined.
 * @param {*} val
 * @returns {string}
 */
function normalizeSeriales(val) {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

/**
 * POST /bomberman/inventariosobra
 * Inserta un registro de inventario de obra que cubre accesorios, herramientas, tuberías, codos,
 * mangueras, reductores y equipos de seguridad.
 * Todos los campos de cantidad `_buena`/`_mala` se convierten a enteros.
 * Los campos de seriales y fechas de vencimiento son opcionales y siempre se incluyen en la inserción.
 * @body {{ nombre_cliente: string, nombre_proyecto: string, fecha_servicio: string, nombre_operador: string, cargo: string, observaciones_generales: string, empresa_id?: number, bomba_pc506_seriales?: string, bomba_pc607_seriales?: string, bomba_tb30_seriales?: string, bomba_tb50_seriales?: string, botiquin_fecha_vencimiento?: string, extintor_fecha_vencimiento?: string, [item_buena: string]: number, [item_mala: string]: number }}
 * @returns {{ message: string, id: number }}
 * @throws {400} Si algún campo requerido está ausente.
 */
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  const required = [
    "nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "cargo",
    "bola_limpieza_tuberia_55_cifa_buena", "bola_limpieza_tuberia_55_cifa_mala",
    "jostick_buena", "jostick_mala",
    "inyector_grasa_buena", "inyector_grasa_mala",
    "caja_herramientas_buena", "caja_herramientas_mala",
    "tubo_entrega_50cm_flanche_plano_buena", "tubo_entrega_50cm_flanche_plano_mala",
    "caneca_5_galones_buena", "caneca_5_galones_mala",
    "caneca_55_galones_buena", "caneca_55_galones_mala",
    "pimpinas_5_6_galones_buena", "pimpinas_5_6_galones_mala",
    "manguera_bicolor_buena", "manguera_bicolor_mala",
    "juego_llaves_x3_piezas_buena", "juego_llaves_x3_piezas_mala",
    "pinza_picolor_buena", "pinza_picolor_mala",
    "bristol_14mm_buena", "bristol_14mm_mala",
    "bristol_12mm_buena", "bristol_12mm_mala",
    "juego_llaves_bristol_x9_buena", "juego_llaves_bristol_x9_mala",
    "cortafrio_buena", "cortafrio_mala",
    "pinzas_punta_buena", "pinzas_punta_mala",
    "llave_expansiva_15_buena", "llave_expansiva_15_mala",
    "maseta_buena", "maseta_mala",
    "tubo_para_abrazadera_buena", "tubo_para_abrazadera_mala",
    "llave_11_buena", "llave_11_mala",
    "llave_10_buena", "llave_10_mala",
    "llave_13_buena", "llave_13_mala",
    "llave_14_buena", "llave_14_mala",
    "llave_17_buena", "llave_17_mala",
    "llave_19_buena", "llave_19_mala",
    "llave_22_buena", "llave_22_mala",
    "llave_24_buena", "llave_24_mala",
    "llave_27_buena", "llave_27_mala",
    "llave_30_buena", "llave_30_mala",
    "llave_32_buena", "llave_32_mala",
    "destornillador_pala_65x125mm_buena", "destornillador_pala_65x125mm_mala",
    "destornillador_pala_8x150mm_buena", "destornillador_pala_8x150mm_mala",
    "destornillador_pala_55x125mm_buena", "destornillador_pala_55x125mm_mala",
    "destornillador_estrella_ph3x150mm_buena", "destornillador_estrella_ph3x150mm_mala",
    "destornillador_estrella_ph2x100mm_buena", "destornillador_estrella_ph2x100mm_mala",
    "destornillador_estrella_ph3x75mm_buena", "destornillador_estrella_ph3x75mm_mala",
    "cunete_grasa_5_galones_buena", "cunete_grasa_5_galones_mala",
    "tubo_3mt_cantidad_buena", "tubo_3mt_cantidad_mala",
    "tubo_2mt_cantidad_buena", "tubo_2mt_cantidad_mala",
    "tubo_1mt_cantidad_buena", "tubo_1mt_cantidad_mala",
    "abrazadera_3_cantidad_buena", "abrazadera_3_cantidad_mala",
    "abrazadera_4_cantidad_buena", "abrazadera_4_cantidad_mala",
    "abrazadera_5_cantidad_buena", "abrazadera_5_cantidad_mala",
    "abrazadera_arranque_5_cifa_buena", "abrazadera_arranque_5_cifa_mala",
    "abrazadera_arranque_6_turbosol_buena", "abrazadera_arranque_6_turbosol_mala",
    "empaque_3_cantidad_buena", "empaque_3_cantidad_mala",
    "empaque_4_cantidad_buena", "empaque_4_cantidad_mala",
    "empaque_5_cantidad_buena", "empaque_5_cantidad_mala",
    "atrapa_diablos_cantidad_buena", "atrapa_diablos_cantidad_mala",
    "codo_45_r1000_buena", "codo_45_r1000_mala",
    "codo_45_r500_buena", "codo_45_r500_mala",
    "codo_45_r275_buena", "codo_45_r275_mala",
    "codo_45_r250_buena", "codo_45_r250_mala",
    "codo_90_r1000_buena", "codo_90_r1000_mala",
    "codo_90_r500_buena", "codo_90_r500_mala",
    "codo_90_r275_buena", "codo_90_r275_mala",
    "codo_90_r250_buena", "codo_90_r250_mala",
    "codo_salida_5_cifa_buena", "codo_salida_5_cifa_mala",
    "codo_salida_6_turbosol_buena", "codo_salida_6_turbosol_mala",
    "empaque_codo_salida_cifa_buena", "empaque_codo_salida_cifa_mala",
    "manguera_3x10_buena", "manguera_3x10_mala",
    "manguera_3x8_buena", "manguera_3x8_mala",
    "manguera_3x6_buena", "manguera_3x6_mala",
    "manguera_4x10_buena", "manguera_4x10_mala",
    "manguera_4x6_buena", "manguera_4x6_mala",
    "manguera_5x6_buena", "manguera_5x6_mala",
    "reduccion_4_a_3_buena", "reduccion_4_a_3_mala",
    "reduccion_5_a_4_buena", "reduccion_5_a_4_mala",
    "reduccion_6_a_5_buena", "reduccion_6_a_5_mala",
    "miple_cantidad_buena", "miple_cantidad_mala",
    "valvula_guillotina_55_buena", "valvula_guillotina_55_mala",
    "extintor_buena", "extintor_mala",
    "botiquin_buena", "botiquin_mala",
    "banco_metalico_buena", "banco_metalico_mala",
    "soportes_metalicos_buena", "soportes_metalicos_mala",
    "observaciones_generales"
  ];

  const optional = [
    "empresa_id",
    "bomba_pc506_seriales",
    "bomba_pc607_seriales",
    "bomba_tb30_seriales",
    "bomba_tb50_seriales",
    "botiquin_fecha_vencimiento",
    "extintor_fecha_vencimiento"
  ];

  const faltantes = required.filter(k => body[k] === undefined || body[k] === null);
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  const integerFields = new Set(required.filter(f => f.endsWith('_buena') || f.endsWith('_mala')));

  const fields = [...required];
  const values = required.map(f => {
    if (integerFields.has(f)) return normalizeInteger(body[f]);
    return body[f];
  });

  const serialFields = new Set([
    'bomba_pc506_seriales',
    'bomba_pc607_seriales',
    'bomba_tb30_seriales',
    'bomba_tb50_seriales'
  ]);

  const dateFields = new Set([
    'botiquin_fecha_vencimiento',
    'extintor_fecha_vencimiento'
  ]);

  optional.forEach(f => {
    if (dateFields.has(f)) {
      fields.push(f);
      values.push(formatDateOnly(body[f]));
      return;
    }

    if (serialFields.has(f)) {
      fields.push(f);
      const val = body[f];
      if (val === undefined || val === null || String(val).trim() === '') {
        values.push(null);
      } else {
        values.push(normalizeSeriales(val));
      }
      return;
    }

    if (body[f] !== undefined) {
      fields.push(f);
      if (f === 'empresa_id') {
        values.push(body[f] ? parseInt(body[f], 10) : null);
      } else if (f.endsWith('_fecha_vencimiento') || f.includes('fecha')) {
        values.push(formatDateOnly(body[f]));
      } else {
        values.push(normalizeSeriales(body[f]));
      }
    }
  });

  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");

  try {
    const query = `INSERT INTO inventario_obra (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Inventario de obra guardado", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar inventario_obra:", error);
    return res.status(500).json({ error: "Error al guardar inventario_obra", detalle: error.message });
  }
});

/**
 * GET /bomberman/inventariosobra
 * Retorna los registros de inventario de obra más recientes.
 * @query {number} [limit=200]
 * @returns {{ registros: Array }}
 */
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM inventario_obra ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener inventario_obra:", error);
    return res.status(500).json({ error: "Error al obtener inventario_obra", detalle: error.message });
  }
});

export default router;
