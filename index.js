import express from "express";
import cors from "cors";
import pkg from "pg";
import formulario1Router from "./routes/gruaman/formulario1.js";
import administradorRouter from "./routes/administrador.js";
import planillaBombeoRouter from "./routes/bomberman/planillabombeo.js";
import checklistRouter from "./routes/bomberman/checklist.js";
import permisoTrabajoRouter from "./routes/compartido/permiso_trabajo.js";
import chequeoAlturasRouter from "./routes/compartido/chequeo_alturas.js";
import chequeoTorregruasRouter from "./routes/gruaman/chequeo_torregruas.js";
import inspeccionEpccRouter from "./routes/gruaman/inspeccion_epcc.js";
import inspeccionIzajeRouter from "./routes/gruaman/inspeccion_izaje.js";

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());
app.use("/bomberman/planillabombeo", planillaBombeoRouter);
app.use("/bomberman/checklist", checklistRouter);

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
  host: "localhost",
  user: "postgres",
  password: "",
  database: "postgres",
  port: 5432,
});

global.db = pool;

// Creación de tablas si no existen
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(50) UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS obras (
      id SERIAL PRIMARY KEY,
      nombre_obra VARCHAR(150) UNIQUE NOT NULL,
      latitud DECIMAL(10,6) NOT NULL,
      longitud DECIMAL(10,6) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trabajadores (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) UNIQUE NOT NULL,
      empresa_id INT REFERENCES empresas(id),
      obra_id INT REFERENCES obras(id),
      numero_identificacion VARCHAR(50) UNIQUE,
      empresa VARCHAR(50) NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS registros_horas (
      id SERIAL PRIMARY KEY,
      trabajador_id INT NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      turno TEXT CHECK (turno IN ('mañana', 'tarde')) NOT NULL,
      hora_usuario TIME NOT NULL,
      hora_sistema TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT CHECK (tipo IN ('entrada', 'salida')) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS planilla_bombeo (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      bomba_numero VARCHAR(20) NOT NULL,
      hora_llegada_obra TIME NOT NULL,
      hora_salida_obra TIME NOT NULL,
      hora_inicio_acpm NUMERIC NOT NULL,
      hora_final_acpm NUMERIC NOT NULL,
      horometro_inicial DECIMAL(10,2) NOT NULL,
      horometro_final DECIMAL(10,2) NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      nombre_auxiliar VARCHAR(100),
      total_metros_cubicos_bombeados DECIMAL(10,2) NOT NULL,
      remision VARCHAR(100),
      hora_llegada TIME,
      hora_inicial TIME,
      hora_final TIME,
      metros DECIMAL(10,2),
      observaciones TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS permiso_trabajo (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      cargo VARCHAR(100) NOT NULL,
      trabajo_rutinario VARCHAR(10) CHECK (trabajo_rutinario IN ('SI','NO','NA')),
      tarea_en_alturas VARCHAR(10) CHECK (tarea_en_alturas IN ('SI','NO','NA')),
      altura_inicial VARCHAR(20),
      altura_final VARCHAR(20),
      herramientas_seleccionadas TEXT,
      herramientas_otros VARCHAR(200),
      certificado_alturas VARCHAR(10) CHECK (certificado_alturas IN ('SI','NO','NA')),
      seguridad_social_arl VARCHAR(10) CHECK (seguridad_social_arl IN ('SI','NO','NA')),
      casco_tipo1 VARCHAR(10) CHECK (casco_tipo1 IN ('SI','NO','NA')),
      gafas_seguridad VARCHAR(10) CHECK (gafas_seguridad IN ('SI','NO','NA')),
      proteccion_auditiva VARCHAR(10) CHECK (proteccion_auditiva IN ('SI','NO','NA')),
      proteccion_respiratoria VARCHAR(10) CHECK (proteccion_respiratoria IN ('SI','NO','NA')),
      guantes_seguridad VARCHAR(10) CHECK (guantes_seguridad IN ('SI','NO','NA')),
      botas_punta_acero VARCHAR(10) CHECK (botas_punta_acero IN ('SI','NO','NA')),
      ropa_reflectiva VARCHAR(10) CHECK (ropa_reflectiva IN ('SI','NO','NA')),
      arnes_cuerpo_entero VARCHAR(10) CHECK (arnes_cuerpo_entero IN ('SI','NO','NA')),
      arnes_cuerpo_entero_dielectico VARCHAR(10) CHECK (arnes_cuerpo_entero_dielectico IN ('SI','NO','NA')),
      mosqueton VARCHAR(10) CHECK (mosqueton IN ('SI','NO','NA')),
      arrestador_caidas VARCHAR(10) CHECK (arrestador_caidas IN ('SI','NO','NA')),
      eslinga_absorbedor VARCHAR(10) CHECK (eslinga_absorbedor IN ('SI','NO','NA')),
      eslinga_posicionamiento VARCHAR(10) CHECK (eslinga_posicionamiento IN ('SI','NO','NA')),
      linea_vida VARCHAR(10) CHECK (linea_vida IN ('SI','NO','NA')),
      eslinga_doble VARCHAR(10) CHECK (eslinga_doble IN ('SI','NO','NA')),
      verificacion_anclaje VARCHAR(10) CHECK (verificacion_anclaje IN ('SI','NO','NA')),
      procedimiento_charla VARCHAR(10) CHECK (procedimiento_charla IN ('SI','NO','NA')),
      medidas_colectivas_prevencion VARCHAR(10) CHECK (medidas_colectivas_prevencion IN ('SI','NO','NA')),
      epp_epcc_buen_estado VARCHAR(10) CHECK (epp_epcc_buen_estado IN ('SI','NO','NA')),
      equipos_herramienta_buen_estado VARCHAR(10) CHECK (equipos_herramienta_buen_estado IN ('SI','NO','NA')),
      inspeccion_sistema VARCHAR(10) CHECK (inspeccion_sistema IN ('SI','NO','NA')),
      plan_emergencia_rescate VARCHAR(10) CHECK (plan_emergencia_rescate IN ('SI','NO','NA')),
      medidas_caida VARCHAR(10) CHECK (medidas_caida IN ('SI','NO','NA')),
      kit_rescate VARCHAR(10) CHECK (kit_rescate IN ('SI','NO','NA')),
      permisos VARCHAR(10) CHECK (permisos IN ('SI','NO','NA')),
      condiciones_atmosfericas VARCHAR(10) CHECK (condiciones_atmosfericas IN ('SI','NO','NA')),
      distancia_vertical_caida VARCHAR(10) CHECK (distancia_vertical_caida IN ('SI','NO','NA')),
      otro_precausiones TEXT,
      vertical_fija VARCHAR(10) CHECK (vertical_fija IN ('SI','NO','NA')),
      vertical_portatil VARCHAR(10) CHECK (vertical_portatil IN ('SI','NO','NA')),
      andamio_multidireccional VARCHAR(10) CHECK (andamio_multidireccional IN ('SI','NO','NA')),
      andamio_colgante VARCHAR(10) CHECK (andamio_colgante IN ('SI','NO','NA')),
      elevador_carga VARCHAR(10) CHECK (elevador_carga IN ('SI','NO','NA')),
      canasta VARCHAR(10) CHECK (canasta IN ('SI','NO','NA')),
      ascensores VARCHAR(10) CHECK (ascensores IN ('SI','NO','NA')),
      otro_equipos TEXT,
      observaciones TEXT,
      motivo_suspension TEXT,
      nombre_suspende VARCHAR(100) NOT NULL,
      nombre_responsable VARCHAR(100) NOT NULL,
      nombre_coordinador VARCHAR(100)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chequeo_alturas (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      cargo VARCHAR(100) NOT NULL,
      sintomas_fisicos VARCHAR(10) CHECK (sintomas_fisicos IN ('SI','NO','NA')),
      medicamento VARCHAR(10) CHECK (medicamento IN ('SI','NO','NA')),
      consumo_sustancias VARCHAR(10) CHECK (consumo_sustancias IN ('SI','NO','NA')),
      condiciones_fisicas_mentales VARCHAR(10) CHECK (condiciones_fisicas_mentales IN ('SI','NO','NA')),
      lugar_trabajo_demarcado VARCHAR(10) CHECK (lugar_trabajo_demarcado IN ('SI','NO','NA')),
      inspeccion_medios_comunicacion VARCHAR(10) CHECK (inspeccion_medios_comunicacion IN ('SI','NO','NA')),
      equipo_demarcado_seguro VARCHAR(10) CHECK (equipo_demarcado_seguro IN ('SI','NO','NA')),
      base_libre_empozamiento VARCHAR(10) CHECK (base_libre_empozamiento IN ('SI','NO','NA')),
      iluminacion_trabajos_nocturnos VARCHAR(10) CHECK (iluminacion_trabajos_nocturnos IN ('SI','NO','NA')),
      uso_adecuado_epp_epcc VARCHAR(10) CHECK (uso_adecuado_epp_epcc IN ('SI','NO','NA')),
      uso_epp_trabajadores VARCHAR(10) CHECK (uso_epp_trabajadores IN ('SI','NO','NA')),
      epcc_adecuado_riesgo VARCHAR(10) CHECK (epcc_adecuado_riesgo IN ('SI','NO','NA')),
      interferencia_otros_trabajos VARCHAR(10) CHECK (interferencia_otros_trabajos IN ('SI','NO','NA')),
      observacion_continua_trabajadores VARCHAR(10) CHECK (observacion_continua_trabajadores IN ('SI','NO','NA')),
      punto_anclaje_definido VARCHAR(10) CHECK (punto_anclaje_definido IN ('SI','NO','NA')),
      inspeccion_previa_sistema_acceso VARCHAR(10) CHECK (inspeccion_previa_sistema_acceso IN ('SI','NO','NA')),
      plan_izaje_cumple_programa VARCHAR(10) CHECK (plan_izaje_cumple_programa IN ('SI','NO','NA')),
      inspeccion_elementos_izaje VARCHAR(10) CHECK (inspeccion_elementos_izaje IN ('SI','NO','NA')),
      limpieza_elementos_izaje VARCHAR(10) CHECK (limpieza_elementos_izaje IN ('SI','NO','NA')),
      auxiliar_piso_asignado VARCHAR(10) CHECK (auxiliar_piso_asignado IN ('SI','NO','NA')),
      consignacion_circuito VARCHAR(10) CHECK (consignacion_circuito IN ('SI','NO','NA')),
      circuitos_identificados VARCHAR(10) CHECK (circuitos_identificados IN ('SI','NO','NA')),
      cinco_reglas_oro VARCHAR(10) CHECK (cinco_reglas_oro IN ('SI','NO','NA')),
      trabajo_con_tension_protocolo VARCHAR(10) CHECK (trabajo_con_tension_protocolo IN ('SI','NO','NA')),
      informacion_riesgos_trabajadores VARCHAR(10) CHECK (informacion_riesgos_trabajadores IN ('SI','NO','NA')),
      distancias_minimas_seguridad VARCHAR(10) CHECK (distancias_minimas_seguridad IN ('SI','NO','NA')),
      tablero_libre_elementos_riesgo VARCHAR(10) CHECK (tablero_libre_elementos_riesgo IN ('SI','NO','NA')),
      cables_en_buen_estado VARCHAR(10) CHECK (cables_en_buen_estado IN ('SI','NO','NA')),
      observaciones TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chequeo_torregruas (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      cargo VARCHAR(100) NOT NULL,
      epp_personal VARCHAR(10) CHECK (epp_personal IN ('SI','NO','NA')),
      epp_contra_caidas VARCHAR(10) CHECK (epp_contra_caidas IN ('SI','NO','NA')),
      ropa_dotacion VARCHAR(10) CHECK (ropa_dotacion IN ('SI','NO','NA')),
      tornilleria_ajustada VARCHAR(10) CHECK (tornilleria_ajustada IN ('SI','NO','NA')),
      anillo_arriostrador VARCHAR(10) CHECK (anillo_arriostrador IN ('SI','NO','NA')),
      soldaduras_buen_estado VARCHAR(10) CHECK (soldaduras_buen_estado IN ('SI','NO','NA')),
      base_buenas_condiciones VARCHAR(10) CHECK (base_buenas_condiciones IN ('SI','NO','NA')),
      funcionamiento_pito VARCHAR(10) CHECK (funcionamiento_pito IN ('SI','NO','NA')),
      cables_alimentacion VARCHAR(10) CHECK (cables_alimentacion IN ('SI','NO','NA')),
      movimientos_maquina VARCHAR(10) CHECK (movimientos_maquina IN ('SI','NO','NA')),
      cables_enrollamiento VARCHAR(10) CHECK (cables_enrollamiento IN ('SI','NO','NA')),
      frenos_funcionando VARCHAR(10) CHECK (frenos_funcionando IN ('SI','NO','NA')),
      poleas_dinamometrica VARCHAR(10) CHECK (poleas_dinamometrica IN ('SI','NO','NA')),
      gancho_seguro VARCHAR(10) CHECK (gancho_seguro IN ('SI','NO','NA')),
      punto_muerto VARCHAR(10) CHECK (punto_muerto IN ('SI','NO','NA')),
      mando_buen_estado VARCHAR(10) CHECK (mando_buen_estado IN ('SI','NO','NA')),
      baldes_buen_estado VARCHAR(10) CHECK (baldes_buen_estado IN ('SI','NO','NA')),
      canasta_materiales VARCHAR(10) CHECK (canasta_materiales IN ('SI','NO','NA')),
      estrobos_buen_estado VARCHAR(10) CHECK (estrobos_buen_estado IN ('SI','NO','NA')),
      grilletes_buen_estado VARCHAR(10) CHECK (grilletes_buen_estado IN ('SI','NO','NA')),
      ayudante_amarre VARCHAR(10) CHECK (ayudante_amarre IN ('SI','NO','NA')),
      radio_comunicacion VARCHAR(10) CHECK (radio_comunicacion IN ('SI','NO','NA')),
      observaciones TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inspeccion_epcc (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(255) NOT NULL,
      nombre_proyecto VARCHAR(255) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(255) NOT NULL,
      cargo VARCHAR(255) NOT NULL,
      serial_arnes VARCHAR(255),
      serial_arrestador VARCHAR(255),
      serial_mosqueton VARCHAR(255),
      serial_posicionamiento VARCHAR(255),
      serial_eslinga_y VARCHAR(255),
      serial_linea_vida VARCHAR(255),
      arnes VARCHAR(10) CHECK (arnes IN ('SI', 'NO', 'NA')) NOT NULL,
      arrestador_caidas VARCHAR(10) CHECK (arrestador_caidas IN ('SI', 'NO', 'NA')) NOT NULL,
      mosqueton VARCHAR(10) CHECK (mosqueton IN ('SI', 'NO', 'NA')) NOT NULL,
      eslinga_posicionamiento VARCHAR(10) CHECK (eslinga_posicionamiento IN ('SI', 'NO', 'NA')) NOT NULL,
      eslinga_y_absorbedor VARCHAR(10) CHECK (eslinga_y_absorbedor IN ('SI', 'NO', 'NA')) NOT NULL,
      linea_vida VARCHAR(10) CHECK (linea_vida IN ('SI', 'NO', 'NA')) NOT NULL,
      observaciones TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inspeccion_izaje (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(255) NOT NULL,
      nombre_proyecto VARCHAR(255) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(255) NOT NULL,
      cargo VARCHAR(255) NOT NULL,
      modelo_grua VARCHAR(255) NOT NULL,
      altura_gancho VARCHAR(255) NOT NULL,
      marca_balde_concreto1 VARCHAR(255),
      serial_balde_concreto1 VARCHAR(255),
      capacidad_balde_concreto1 VARCHAR(255),
      balde_concreto1_buen_estado VARCHAR(10) CHECK (balde_concreto1_buen_estado IN ('SI','NO','NA')) NOT NULL,
      balde_concreto1_mecanismo_apertura VARCHAR(10) CHECK (balde_concreto1_mecanismo_apertura  IN ('SI','NO','NA')) NOT NULL,
      balde_concreto1_soldadura VARCHAR(10) CHECK (balde_concreto1_soldadura IN ('SI','NO','NA')) NOT NULL,
      balde_concreto1_estructura VARCHAR(10) CHECK (balde_concreto1_estructura IN ('SI','NO','NA')) NOT NULL,
      balde_concreto1_aseo VARCHAR(10) CHECK (balde_concreto1_aseo IN ('SI','NO','NA')) NOT NULL,
      marca_balde_concreto2 VARCHAR(255),
      serial_balde_concreto2 VARCHAR(255),
      capacidad_balde_concreto2 VARCHAR(255),
      balde_concreto2_buen_estado VARCHAR(10) CHECK (balde_concreto2_buen_estado IN ('SI','NO','NA')) NOT NULL,
      balde_concreto2_mecanismo_apertura VARCHAR(10) CHECK (balde_concreto2_mecanismo_apertura  IN ('SI','NO','NA')) NOT NULL,
      balde_concreto2_soldadura VARCHAR(10) CHECK (balde_concreto2_soldadura IN ('SI','NO','NA')) NOT NULL,
      balde_concreto2_estructura VARCHAR(10) CHECK (balde_concreto2_estructura IN ('SI','NO','NA')) NOT NULL,
      balde_concreto2_aseo VARCHAR(10) CHECK (balde_concreto2_aseo IN ('SI','NO','NA')) NOT NULL,
      marca_balde_escombro VARCHAR(255),
      serial_balde_escombro VARCHAR(255),
      capacidad_balde_escombro VARCHAR(255),
      balde_escombro_buen_estado VARCHAR(10) CHECK (balde_escombro_buen_estado IN ('SI','NO','NA')) NOT NULL,
      balde_escombro_mecanismo_apertura VARCHAR(10) CHECK (balde_escombro_mecanismo_apertura  IN ('SI','NO','NA')) NOT NULL,
      balde_escombro_soldadura VARCHAR(10) CHECK (balde_escombro_soldadura IN ('SI','NO','NA')) NOT NULL,
      balde_escombro_estructura VARCHAR(10) CHECK (balde_escombro_estructura IN ('SI','NO','NA')) NOT NULL,
      marca_canasta_material VARCHAR(255),
      serial_canasta_material VARCHAR(255),
      capacidad_canasta_material VARCHAR(255),
      canasta_material_buen_estado VARCHAR(10) CHECK (canasta_material_buen_estado IN ('SI','NO','NA')) NOT NULL,
      canasta_material_malla_seguridad_intacta VARCHAR(10) CHECK (canasta_material_malla_seguridad_intacta IN ('SI','NO','NA')) NOT NULL,
      canasta_material_espadas VARCHAR(10) CHECK (canasta_material_espadas IN ('SI','NO','NA')) NOT NULL,
      canasta_material_soldadura VARCHAR(10) CHECK (canasta_material_soldadura IN ('SI','NO','NA')) NOT NULL,
      numero_eslinga_cadena VARCHAR(255),
      capacidad_eslinga_cadena VARCHAR(255),
      eslinga_cadena_ramales VARCHAR(10) CHECK (eslinga_cadena_ramales IN ('SI','NO','NA')) NOT NULL,
      eslinga_cadena_grilletes VARCHAR(10) CHECK (eslinga_cadena_grilletes IN ('SI','NO','NA')) NOT NULL,
      eslinga_cadena_tornillos VARCHAR(10) CHECK (eslinga_cadena_tornillos IN ('SI','NO','NA')) NOT NULL,
      serial_eslinga_sintetica VARCHAR(255),
      capacidad_eslinga_sintetica VARCHAR(255),
      eslinga_sintetica_textil VARCHAR(10) CHECK (eslinga_sintetica_textil IN ('SI','NO','NA')) NOT NULL,
      eslinga_sintetica_costuras VARCHAR(10) CHECK (eslinga_sintetica_costuras IN ('SI','NO','NA')) NOT NULL,
      eslinga_sintetica_etiquetas VARCHAR(10) CHECK (eslinga_sintetica_etiquetas IN ('SI','NO','NA')) NOT NULL,
      serial_grillete VARCHAR(255),
      capacidad_grillete VARCHAR(255),
      grillete_perno_danos VARCHAR(10) CHECK (grillete_perno_danos IN ('SI','NO','NA')) NOT NULL,
      grillete_cuerpo_buen_estado VARCHAR(10) CHECK (grillete_cuerpo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      observaciones TEXT
    );
  `);
})();

// Devuelve los nombres de todos los trabajadores
app.get("/nombres_trabajadores", async (req, res) => {
  try {
    const result = await pool.query(`SELECT nombre FROM trabajadores`);
    const nombres = result.rows.map(row => row.nombre);
    res.json({ nombres });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los nombres de trabajadores" });
  }
});

// Guarda los datos básicos de un trabajador
app.post("/datos_basicos", async (req, res) => {
  const { nombre, empresa, empresa_id, obra_id, numero_identificacion } = req.body;

  if (!nombre || !empresa || !empresa_id || !obra_id || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  try {
    const trabajador = await pool.query(
      `SELECT id, empresa_id, obra_id, numero_identificacion FROM trabajadores WHERE nombre = $1`,
      [nombre]
    );
    let trabajadorId;
    if (trabajador.rows.length === 0) {
      const result = await pool.query(
        `INSERT INTO trabajadores (nombre, empresa_id, obra_id, numero_identificacion, empresa)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [nombre, empresa_id, obra_id, numero_identificacion, empresa]
      );
      trabajadorId = result.rows[0].id;
    } else {
      trabajadorId = trabajador.rows[0].id;
      if (trabajador.rows[0].empresa_id !== empresa_id)
        await pool.query(`UPDATE trabajadores SET empresa_id = $1 WHERE id = $2`, [empresa_id, trabajadorId]);
      if (trabajador.rows[0].obra_id !== obra_id)
        await pool.query(`UPDATE trabajadores SET obra_id = $1 WHERE id = $2`, [obra_id, trabajadorId]);
      if (trabajador.rows[0].numero_identificacion !== numero_identificacion)
        await pool.query(`UPDATE trabajadores SET numero_identificacion = $1 WHERE id = $2`, [numero_identificacion, trabajadorId]);
      if (trabajador.rows[0].empresa !== empresa)
        await pool.query(`UPDATE trabajadores SET empresa = $1 WHERE id = $2`, [empresa, trabajadorId]);
    }

    res.json({
      message: "Datos básicos guardados",
      trabajadorId,
      nombre,
      empresa,
      empresa_id,
      obra_id,
      numero_identificacion,
    });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar los datos" });
  }
});

// Devuelve el ID de un trabajador según los parámetros proporcionados
app.get("/trabajador_id", async (req, res) => {
  const { nombre, empresa, obra, numero_identificacion } = req.query;
  if (!nombre || !empresa || !obra || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }
  try {
    const empresaRows = await pool.query(`SELECT id FROM empresas WHERE nombre = $1`, [empresa]);
    const obraRows = await pool.query(`SELECT id FROM obras WHERE nombre_obra = $1`, [obra]);

    if (empresaRows.rows.length === 0 || obraRows.rows.length === 0)
      return res.status(404).json({ error: "Empresa u obra no encontrada" });

    const empresa_id = empresaRows.rows[0].id;
    const obra_id = obraRows.rows[0].id;

    const trabajador = await pool.query(
      `SELECT id, nombre, empresa_id, obra_id, numero_identificacion, empresa
       FROM trabajadores WHERE nombre = $1 AND empresa_id = $2 AND obra_id = $3 AND numero_identificacion = $4`,
      [nombre, empresa_id, obra_id, numero_identificacion]
    );

    if (trabajador.rows.length === 0)
      return res.status(404).json({ error: "Trabajador no encontrado" });

    const empresaObj = await pool.query(`SELECT nombre FROM empresas WHERE id = $1`, [empresa_id]);
    const obraObj = await pool.query(`SELECT nombre_obra FROM obras WHERE id = $1`, [obra_id]);

    res.json({
      trabajadorId: trabajador.rows[0].id,
      nombre: trabajador.rows[0].nombre,
      empresa: empresaObj.rows[0]?.nombre || empresa,
      obra: obraObj.rows[0]?.nombre_obra || obra,
      numero_identificacion: trabajador.rows[0].numero_identificacion,
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener trabajador" });
  }
});

// Devuelve todas las obras registradas
app.get("/obras", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, nombre_obra, constructora FROM obras`);
    res.json({ obras: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las obras" });
  }
});

// Devuelve los números de bomba registrados
app.get("/bombas", async (req, res) => {
  try {
    const result = await pool.query(`SELECT numero_bomba FROM bombas`);
    res.json({ bombas: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los números de bomba" });
  }
});

// Valida si una ubicación está dentro del rango permitido para una obra
app.post("/validar_ubicacion", async (req, res) => {
  const { obra_id, lat, lon } = req.body;
  if (!obra_id || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ ok: false, message: "Parámetros inválidos" });
  }
  try {
    const result = await pool.query(`SELECT latitud, longitud FROM obras WHERE id = $1`, [obra_id]);
    if (result.rows.length === 0 || result.rows[0].latitud == null || result.rows[0].longitud == null) {
      return res.status(404).json({ ok: false, message: "Obra no encontrada o sin coordenadas" });
    }
    const { latitud, longitud } = result.rows[0];
    const distancia = getDistanceFromLatLonInMeters(lat, lon, latitud, longitud);
    if (distancia <= 100) {
      res.json({ ok: true });
    } else {
      res.status(403).json({ ok: false, message: "No estás en la ubicación de la obra seleccionada" });
    }
  } catch (error) {
    res.status(500).json({ ok: false, message: "Error al validar ubicación" });
  }
});

// Calcula la distancia entre dos coordenadas geográficas
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Monta los routers para las rutas específicas
app.use("/formulario1", formulario1Router);
app.use("/administrador", administradorRouter);
app.use("/compartido/permiso_trabajo", permisoTrabajoRouter);
app.use("/compartido/chequeo_alturas", chequeoAlturasRouter);
app.use("/gruaman/chequeo_torregruas", chequeoTorregruasRouter);
app.use("/gruaman/inspeccion_epcc", inspeccionEpccRouter);
app.use("/gruaman/inspeccion_izaje", inspeccionIzajeRouter);

app.listen(3000, () =>
  console.log("✅ API corriendo en http://localhost:3000 (PostgreSQL conectado)")
);
