import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pkg from "pg";
import bcrypt from "bcrypt";
import webpush from "web-push";
import cron from "node-cron";
import administradorRouter from "./routes/adminsitrador_gruaman/permiso_trabajo_admin.js";
import inspeccionIzajeAdminRouter from "./routes/adminsitrador_gruaman/inspeccion_izaje_admin.js";
import inspeccionEPCCAdminsRouter from "./routes/adminsitrador_gruaman/inspeccion_EPCC_admins.js";
import planillaBombeoRouter from "./routes/bomberman/planillabombeo.js";
import checklistRouter from "./routes/bomberman/checklist.js";
import permisoTrabajoRouter from "./routes/compartido/permiso_trabajo.js";
import chequeoAlturasRouter from "./routes/compartido/chequeo_alturas.js";
import chequeoTorregruasRouter from "./routes/gruaman/chequeo_torregruas.js";
import inspeccionEpccRouter from "./routes/gruaman/inspeccion_epcc.js";
import inspeccionIzajeRouter from "./routes/gruaman/inspeccion_izaje.js";
import inventariosObraRouter from "./routes/bomberman/inventariosobra.js";
import inspeccionEpccBombermanRouter from "./routes/bomberman/inspeccion_epcc_bomberman.js";
import herramientasMantenimientoRouter from "./routes/bomberman/herramientas_mantenimiento.js";
import kitLimpiezaRouter from "./routes/bomberman/kit_limpieza.js";
import chequeoElevadorRouter from "./routes/gruaman/chequeo_elevador.js";
import atsRouter from "./routes/gruaman/ats.js";
import fetch from 'node-fetch';
import chequeoTorregruasAdminRouter from "./routes/adminsitrador_gruaman/chequeo_torregruas_admin.js";
import chequeoElevadorAdminRouter from "./routes/adminsitrador_gruaman/chequeo_elevador_admin.js";
import chequeoAlturasAdminRouter from "./routes/adminsitrador_gruaman/chequeo_alturas_admin.js";
import planillaBombeoAdminRouter from "./routes/administrador_bomberman/planilla_bombeo_admin.js";
import inventariosObraAdminRouter from "./routes/administrador_bomberman/inventarios_obra_admin.js";
import inspeccionEpccBombermanAdminRouter from "./routes/administrador_bomberman/inspeccion_epcc_bomberman_admin.js";
import checklistAdminRouter from "./routes/administrador_bomberman/checklist_admin.js";
import herramientasMantenimientoAdminRouter from "./routes/administrador_bomberman/herramientas_mantenimiento_admin.js";
import kitLimpiezaAdminRouter from "./routes/administrador_bomberman/kit_limpieza_admin.js";
import adminUsuariosRouter from "./routes/administrador/admin_usuarios.js";
import adminObrasRouter from "./routes/administrador/admin_obras.js";
// adminHorasExtraRouter se importa dinámicamente dentro del IIFE de inicio para
// garantizar que global.db esté disponible antes de que se evalúe el módulo.
import webauthnRouter, { configureWebAuthnSession } from './routes/webauthn.js';
import signioRouter, { configureSignioAuth } from './routes/signio.js';
import registrosDiariosRouter from './routes/administrador/registros_diarios.js';
import indicadorCentralRouter from './routes/administrador/indicador_central.js';
import authPinRouter, { configureAuthPinSession } from './routes/auth_pin.js';
import pqrRouter from './routes/sst/pqr.js';
import empresaRouter from './routes/empresa/empresa.js'
import { getIndicadorCentralDefaultConfig, runIndicadorCentralCutoff } from './helpers/indicador_central.js';
import { createAuthConfig, isLocalhostOrigin } from "./config/authConfig.js";
import { createAuthSessionController } from "./controllers/authSessionController.js";
import { createAuthSessionRouter } from "./routes/auth_session.js";
import { createAuthenticateSession } from "./middlewares/authenticateSession.js";
import { createCsrfProtection } from "./middlewares/csrfProtection.js";
import { createAuthDebugLogger } from "./middlewares/authDebugLogger.js";
import { requirePermission } from "./middlewares/requirePermission.js";
import { requireRole } from "./middlewares/requireRole.js";
import { requireWorkerSelfOrAdmin } from "./middlewares/requireWorkerSelfOrAdmin.js";
import { initializeAuthSessionSchema, createAuthSessionRepository } from "./repositories/authSessionRepository.js";
import { createAuthSessionService } from "./services/authSessionService.js";
import { writeAuthCookies } from "./helpers/authCookies.js";

import dotenv from "dotenv";
import { log } from "console";

function normalizePushEndpoint(subscription) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    return null;
  }
  const endpoint = subscription.endpoint;
  if (typeof endpoint !== "string") return null;
  const normalized = endpoint.trim();
  return normalized.length > 0 ? normalized : null;
}

function isTerminalPushError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const body = String(error?.body || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    statusCode === 404 ||
    statusCode === 410 ||
    body.includes("unsubscribed") ||
    body.includes("expired") ||
    body.includes("revoked") ||
    message.includes("unsubscribed") ||
    message.includes("expired") ||
    message.includes("revoked")
  );
}
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env" });
} else {
  dotenv.config({ path: [".env.local", ".env"] });
}

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Envía una notificación Web Push a una suscripción con un TTL de 24 horas
 * y urgencia alta.
 * @param {object} subscription - Objeto PushSubscription (endpoint + keys).
 * @param {{ title: string, body: string, icon?: string, url?: string }} payload
 * @returns {Promise<void>}
 */
async function sendPushNotification(subscription, payload) {
  const options = {
    TTL: 86400,
    headers: {
      'Content-Type': 'application/json',
      'Urgency': 'high'
    }
  };
  return webpush.sendNotification(
    subscription,
    JSON.stringify(payload),
    options
  );
}

const { Pool } = pkg;
const app = express();
const authConfig = createAuthConfig();

// Credentialed CORS must use exact origins. Localhost is allowed by default only outside production.
function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (authConfig.cors.allowLocalhost && isLocalhostOrigin(origin)) return true;
  return authConfig.cors.allowedOrigins.includes(origin);
}

app.use(createAuthDebugLogger());
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token", authConfig.csrf.headerName],
  optionsSuccessStatus: 204
}));
app.use(cookieParser());
app.use(express.json());
app.use('/webauthn', webauthnRouter);
app.use('/signio', signioRouter);
app.use('/auth/pin', authPinRouter);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "postgres",
      port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    });

global.db = pool;

const authSessionRepository = createAuthSessionRepository({ db: pool });
const authSessionService = createAuthSessionService({
  db: pool,
  sessionRepository: authSessionRepository,
  authConfig
});
const authSessionController = createAuthSessionController({
  authSessionService,
  authConfig
});
const csrfProtection = createCsrfProtection({ authConfig });
const authenticateSession = createAuthenticateSession({ authSessionService, authConfig });
const requireAdminRead = requirePermission("admin:read");
const requireGruamanAdmin = requirePermission("admin:gruaman:*");
const requireBombermanAdmin = requirePermission("admin:bomberman:*");
const requireAuthenticatedActor = requireRole("worker", "admin:gruaman", "admin:bomberman");
const requireBodyWorkerSelfOrAdmin = requireWorkerSelfOrAdmin((req) => req.body?.numero_identificacion);

configureAuthPinSession({ authSessionService, authConfig, authenticateSession, csrfProtection });
configureWebAuthnSession({ authSessionService, authConfig, authenticateSession, csrfProtection });
configureSignioAuth({ authenticateSession, requireAdminRead });
app.use('/auth', createAuthSessionRouter({ authSessionController, csrfProtection }));

/**
 * IIFE de inicio: ejecuta todas las migraciones idempotentes CREATE TABLE / ALTER TABLE,
 * luego importa y monta dinámicamente los routers que dependen de global.db.
 */
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

  await pool.query(`ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS pin_habilitado BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
  await pool.query(`ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(100)`).catch(() => {});
  await pool.query(`ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true`).catch(() => {});
  await pool.query(`ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS cargo VARCHAR(100)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS horas_jornada (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      cargo VARCHAR(100),
      empresa_id INT REFERENCES empresas(id),
      hora_ingreso TIME NOT NULL,
      hora_salida TIME,
      minutos_almuerzo INT CHECK (minutos_almuerzo >= 1 AND minutos_almuerzo <= 60)
    );
  `);
  await pool.query(`ALTER TABLE horas_jornada ADD COLUMN IF NOT EXISTS id SERIAL`).catch(() => {});
  await pool.query(`ALTER TABLE horas_jornada ALTER COLUMN hora_salida DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE horas_jornada ALTER COLUMN cargo DROP NOT NULL`).catch(() => {});

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
    ALTER TABLE planilla_bombeo
      ALTER COLUMN hora_llegada_obra DROP NOT NULL,
      ALTER COLUMN hora_salida_obra DROP NOT NULL
  `).catch(() => {});

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chequeo_elevador (
      id SERIAL PRIMARY KEY,
      nombre_cliente              VARCHAR(100) NOT NULL,
      nombre_proyecto             VARCHAR(100) NOT NULL,
      fecha_servicio              DATE NOT NULL,
      nombre_operador             VARCHAR(100) NOT NULL,
      cargo                       VARCHAR(100) NOT NULL,
      epp_completo_y_en_buen_estado VARCHAR(10) CHECK (epp_completo_y_en_buen_estado IN ('SI','NO','NA')) NOT NULL,
      epcc_completo_y_en_buen_estado VARCHAR(10) CHECK (epcc_completo_y_en_buen_estado IN ('SI','NO','NA')) NOT NULL,
      estructura_equipo_buen_estado VARCHAR(10) CHECK (estructura_equipo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      equipo_sin_fugas_fluido VARCHAR(10) CHECK (equipo_sin_fugas_fluido IN ('SI','NO','NA')) NOT NULL,
      tablero_mando_buen_estado VARCHAR(10) CHECK (tablero_mando_buen_estado IN ('SI','NO','NA')) NOT NULL,
      puerta_acceso_buen_estado VARCHAR(10) CHECK (puerta_acceso_buen_estado IN ('SI','NO','NA')) NOT NULL,
      gancho_seguridad_funciona_correctamente VARCHAR(10) CHECK (gancho_seguridad_funciona_correctamente IN ('SI','NO','NA')) NOT NULL,
      plataforma_limpia_y_sin_sustancias_deslizantes VARCHAR(10) CHECK (plataforma_limpia_y_sin_sustancias_deslizantes IN ('SI','NO','NA')) NOT NULL,
      cabina_libre_de_escombros_y_aseada VARCHAR(10) CHECK (cabina_libre_de_escombros_y_aseada IN ('SI','NO','NA')) NOT NULL,
      cables_electricos_y_motor_buen_estado VARCHAR(10) CHECK (cables_electricos_y_motor_buen_estado IN ('SI','NO','NA')) NOT NULL,
      anclajes_y_arriostramientos_bien_asegurados VARCHAR(10) CHECK (anclajes_y_arriostramientos_bien_asegurados IN ('SI','NO','NA')) NOT NULL,
      secciones_equipo_bien_acopladas VARCHAR(10) CHECK (secciones_equipo_bien_acopladas IN ('SI','NO','NA')) NOT NULL,
      rodillos_guia_buen_estado_y_lubricados VARCHAR(10) CHECK (rodillos_guia_buen_estado_y_lubricados IN ('SI','NO','NA')) NOT NULL,
      rieles_seguridad_techo_buen_estado VARCHAR(10) CHECK (rieles_seguridad_techo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      plataforma_trabajo_techo_buen_estado VARCHAR(10) CHECK (plataforma_trabajo_techo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      escalera_acceso_techo_buen_estado VARCHAR(10) CHECK (escalera_acceso_techo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      freno_electromagnetico_buen_estado VARCHAR(10) CHECK (freno_electromagnetico_buen_estado IN ('SI','NO','NA')) NOT NULL,
      sistema_velocidad_calibrado_y_engranes_buen_estado VARCHAR(10) CHECK (sistema_velocidad_calibrado_y_engranes_buen_estado IN ('SI','NO','NA')) NOT NULL,
      limitantes_superior_inferior_calibrados VARCHAR(10) CHECK (limitantes_superior_inferior_calibrados IN ('SI','NO','NA')) NOT NULL,
      area_equipo_senalizada_y_demarcada VARCHAR(10) CHECK (area_equipo_senalizada_y_demarcada IN ('SI','NO','NA')) NOT NULL,
      equipo_con_parada_emergencia VARCHAR(10) CHECK (equipo_con_parada_emergencia IN ('SI','NO','NA')) NOT NULL,
      placa_identificacion_con_carga_maxima VARCHAR(10) CHECK (placa_identificacion_con_carga_maxima IN ('SI','NO','NA')) NOT NULL,
      sistema_sobrecarga_funcional VARCHAR(10) CHECK (sistema_sobrecarga_funcional IN ('SI','NO','NA')) NOT NULL,
      cabina_desinfectada_previamente VARCHAR(10) CHECK (cabina_desinfectada_previamente IN ('SI','NO','NA')) NOT NULL,
      observaciones_generales TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_passwords (
      id SERIAL PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      rol VARCHAR(30) NOT NULL CHECK (rol IN ('gruaman', 'bomberman'))
    );
  `);

  await initializeAuthSessionSchema(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      trabajador_id INT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription JSONB NOT NULL,
      creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_suscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS fecha_suscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE push_subscriptions ALTER COLUMN trabajador_id SET NOT NULL`).catch(() => {});

  await pool.query(`
    UPDATE push_subscriptions
    SET endpoint = NULLIF(TRIM(subscription->>'endpoint'), '')
    WHERE endpoint IS NULL
  `).catch(() => {});

  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint IS NULL`).catch(() => {});

  await pool.query(`
    DELETE FROM push_subscriptions ps
    USING push_subscriptions dup
    WHERE ps.id < dup.id
      AND ps.trabajador_id = dup.trabajador_id
      AND COALESCE(ps.endpoint, '') = COALESCE(dup.endpoint, '')
      AND COALESCE(ps.endpoint, '') <> ''
  `).catch(() => {});

  await pool.query(`ALTER TABLE push_subscriptions ALTER COLUMN endpoint SET NOT NULL`).catch(() => {});

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_push_subscriptions_worker_endpoint
    ON push_subscriptions (trabajador_id, endpoint)
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cron_locks (
      lock_id VARCHAR(100) PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_notification_dispatches (
      id BIGSERIAL PRIMARY KEY,
      job_key VARCHAR(100) NOT NULL,
      trabajador_id INT NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
      subscription_id INT REFERENCES push_subscriptions(id) ON DELETE CASCADE,
      endpoint TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'sent',
      provider_status_code INT,
      window_key VARCHAR(30) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (job_key, subscription_id, window_key)
    );
  `);

  await pool.query(`ALTER TABLE push_notification_dispatches ADD COLUMN IF NOT EXISTS subscription_id INT REFERENCES push_subscriptions(id) ON DELETE CASCADE`).catch(() => {});
  await pool.query(`ALTER TABLE push_notification_dispatches ADD COLUMN IF NOT EXISTS endpoint TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE push_notification_dispatches ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'sent'`).catch(() => {});
  await pool.query(`ALTER TABLE push_notification_dispatches ADD COLUMN IF NOT EXISTS provider_status_code INT`).catch(() => {});
  await pool.query(`ALTER TABLE push_notification_dispatches DROP CONSTRAINT IF EXISTS push_notification_dispatches_job_key_trabajador_id_window_k_key`).catch(() => {});
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_push_dispatch_job_subscription_window
    ON push_notification_dispatches (job_key, subscription_id, window_key)
    WHERE subscription_id IS NOT NULL
  `).catch(() => {});

  await pool.query(`DELETE FROM cron_locks WHERE created_at < NOW() - INTERVAL '1 day'`).catch(() => {});
  await pool.query(`DELETE FROM push_notification_dispatches WHERE created_at < NOW() - INTERVAL '7 days'`).catch(() => {});

  await pool.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS empresa_id INT REFERENCES empresas(id)`).catch(() => {});
  await pool.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS constructora VARCHAR(150) NOT NULL DEFAULT ''`).catch(() => {});
  await pool.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true`).catch(() => {});
  await pool.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS departamento_id INT`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS indicador_central_config_versions (
      id SERIAL PRIMARY KEY,
      version INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT false,
      destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb,
      umbrales JSONB NOT NULL DEFAULT '{}'::jsonb,
      formatos_por_empresa JSONB NOT NULL DEFAULT '{}'::jsonb,
      exclusiones JSONB NOT NULL DEFAULT '[]'::jsonb,
      distribucion_habilitada BOOLEAN NOT NULL DEFAULT false,
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS indicador_central_ejecuciones (
      id SERIAL PRIMARY KEY,
      corte_tipo VARCHAR(20) NOT NULL,
      corte_fecha DATE NOT NULL,
      canal VARCHAR(30) NOT NULL DEFAULT 'email',
      estado VARCHAR(20) NOT NULL,
      origen VARCHAR(20) NOT NULL,
      config_version_id INT REFERENCES indicador_central_config_versions(id),
      snapshot_batch_id VARCHAR(100),
      destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb,
      resumen JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS indicador_central_dataset_snapshot (
      id SERIAL PRIMARY KEY,
      batch_id VARCHAR(100) NOT NULL,
      execution_id INT REFERENCES indicador_central_ejecuciones(id) ON DELETE SET NULL,
      corte_tipo VARCHAR(20) NOT NULL,
      corte_fecha DATE NOT NULL,
      fecha_registro DATE NOT NULL,
      empresa_id INT,
      empresa VARCHAR(100),
      nombre_operador VARCHAR(150) NOT NULL,
      nombre_proyecto VARCHAR(150),
      obra_id INT,
      obra_nombre VARCHAR(150),
      actividad_registrada BOOLEAN NOT NULL DEFAULT false,
      cumplimiento_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
      total_registros INT NOT NULL DEFAULT 0,
      formatos_llenos JSONB NOT NULL DEFAULT '[]'::jsonb,
      formatos_faltantes JSONB NOT NULL DEFAULT '[]'::jsonb,
      anomalias JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_indicador_central_snapshot_batch ON indicador_central_dataset_snapshot (batch_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_indicador_central_snapshot_corte ON indicador_central_dataset_snapshot (corte_fecha)`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_indicador_central_success ON indicador_central_ejecuciones (corte_tipo, corte_fecha, canal) WHERE estado = 'success'`).catch(() => {});

  const indicadorConfigCount = await pool.query(`SELECT COUNT(*)::int AS total FROM indicador_central_config_versions`);
  if (Number(indicadorConfigCount.rows[0]?.total || 0) === 0) {
    const defaultConfig = getIndicadorCentralDefaultConfig();
    await pool.query(
      `INSERT INTO indicador_central_config_versions (
        version,
        is_active,
        destinatarios,
        umbrales,
        formatos_por_empresa,
        exclusiones,
        distribucion_habilitada,
        scope,
        updated_by
      ) VALUES (1, true, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6::jsonb, 'bootstrap')`,
      [
        JSON.stringify(defaultConfig.destinatarios || []),
        JSON.stringify(defaultConfig.umbrales || {}),
        JSON.stringify(defaultConfig.formatos_por_empresa || {}),
        JSON.stringify(defaultConfig.exclusiones || []),
        defaultConfig.distribucion_habilitada === true,
        JSON.stringify(defaultConfig.scope || {})
      ]
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pqr (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(255) NOT NULL,
      nombre_proyecto VARCHAR(255) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(255) NOT NULL,
      nombre_director VARCHAR(255) NOT NULL,
      area VARCHAR(255) NOT NULL,
      pqr TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ats (
      id                          SERIAL PRIMARY KEY,
      tipo_ats                    VARCHAR(100)  NOT NULL,
      fecha_elaboracion           DATE          DEFAULT CURRENT_DATE,
      lugar_obra                  VARCHAR(255),
      contratista                 VARCHAR(255)  DEFAULT 'N/A',
      valido_desde                DATE,
      valido_hasta                DATE,
      nombre_operador             VARCHAR(255),
      cargo                       VARCHAR(255),
      empresa_id                  INTEGER       DEFAULT 1,
      riesgo_radiacion_solar      BOOLEAN DEFAULT FALSE,
      riesgo_ruido                BOOLEAN DEFAULT FALSE,
      riesgo_alta_tension         BOOLEAN DEFAULT FALSE,
      riesgo_radiacion_ionizante  BOOLEAN DEFAULT FALSE,
      riesgo_vibraciones          BOOLEAN DEFAULT FALSE,
      riesgo_electricidad_estatica BOOLEAN DEFAULT FALSE,
      riesgo_tormentas_electricas BOOLEAN DEFAULT FALSE,
      riesgo_iluminacion_deficiente BOOLEAN DEFAULT FALSE,
      riesgo_baja_tension         BOOLEAN DEFAULT FALSE,
      riesgo_calor                BOOLEAN DEFAULT FALSE,
      riesgo_frio_humedad         BOOLEAN DEFAULT FALSE,
      riesgo_aerosol              BOOLEAN DEFAULT FALSE,
      riesgo_polvos               BOOLEAN DEFAULT FALSE,
      riesgo_vapores              BOOLEAN DEFAULT FALSE,
      riesgo_sobre_esfuerzo       BOOLEAN DEFAULT FALSE,
      riesgo_posturas_incomodas   BOOLEAN DEFAULT FALSE,
      riesgo_posturas_estaticas   BOOLEAN DEFAULT FALSE,
      riesgo_movimientos_repetitivos BOOLEAN DEFAULT FALSE,
      riesgo_psicosocial          BOOLEAN DEFAULT FALSE,
      riesgo_naturales            BOOLEAN DEFAULT FALSE,
      riesgo_caida_mismo_nivel    BOOLEAN DEFAULT FALSE,
      riesgo_caida_distinto_nivel BOOLEAN DEFAULT FALSE,
      riesgo_caida_objetos        BOOLEAN DEFAULT FALSE,
      riesgo_cambio_temperatura   BOOLEAN DEFAULT FALSE,
      riesgo_desprendimiento      BOOLEAN DEFAULT FALSE,
      riesgo_hundimientos         BOOLEAN DEFAULT FALSE,
      riesgo_atropellamiento      BOOLEAN DEFAULT FALSE,
      riesgo_golpes_machacones    BOOLEAN DEFAULT FALSE,
      riesgo_atrapamientos        BOOLEAN DEFAULT FALSE,
      riesgo_mecanismos_movimiento BOOLEAN DEFAULT FALSE,
      riesgo_proyeccion_particulas BOOLEAN DEFAULT FALSE,
      riesgo_choques              BOOLEAN DEFAULT FALSE,
      riesgo_espacios_reducidos   BOOLEAN DEFAULT FALSE,
      riesgo_cortes_herramienta   BOOLEAN DEFAULT FALSE,
      riesgo_caida_objetos_mec    BOOLEAN DEFAULT FALSE,
      riesgo_bacterias_virus      BOOLEAN DEFAULT FALSE,
      riesgo_picadura_insectos    BOOLEAN DEFAULT FALSE,
      riesgo_ofidio               BOOLEAN DEFAULT FALSE,
      riesgo_mordedura_caninos    BOOLEAN DEFAULT FALSE,
      herramientas_manuales       TEXT,
      herramientas_electricas     TEXT,
      herramientas_neumaticas     TEXT,
      herramientas_hidraulicas    TEXT,
      herramientas_mecanicas      TEXT,
      herramientas_otras          TEXT,
      epp_casco                   BOOLEAN DEFAULT FALSE,
      epp_proteccion_auditiva     BOOLEAN DEFAULT FALSE,
      epp_mascarilla_polvo        BOOLEAN DEFAULT FALSE,
      epp_arnes_cuerpo_completo   BOOLEAN DEFAULT FALSE,
      epp_botas_seguridad         BOOLEAN DEFAULT FALSE,
      epp_guantes                 BOOLEAN DEFAULT FALSE,
      epp_eslinga_y_absorbente    BOOLEAN DEFAULT FALSE,
      epp_lineas_vida             BOOLEAN DEFAULT FALSE,
      epp_gafas_seguridad         BOOLEAN DEFAULT FALSE,
      epp_overol                  BOOLEAN DEFAULT FALSE,
      epp_arrestador_caidas       BOOLEAN DEFAULT FALSE,
      paso_1_confirmado           BOOLEAN DEFAULT FALSE,
      paso_2_confirmado           BOOLEAN DEFAULT FALSE,
      paso_3_confirmado           BOOLEAN DEFAULT FALSE,
      paso_4_confirmado           BOOLEAN DEFAULT FALSE,
      paso_5_confirmado           BOOLEAN DEFAULT FALSE,
      paso_6_confirmado           BOOLEAN DEFAULT FALSE,
      paso_7_confirmado           BOOLEAN DEFAULT FALSE,
      paso_8_confirmado           BOOLEAN DEFAULT FALSE,
      paso_9_confirmado           BOOLEAN DEFAULT FALSE,
      created_at                  TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ats_tipo    ON ats (tipo_ats)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ats_empresa ON ats (empresa_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ats_fecha   ON ats (fecha_elaboracion)`).catch(() => {});

  const { default: adminHorasExtraRouter } = await import("./routes/administrador/admin_horas_extra.js");
  app.use("/administrador/admin_horas_extra", authenticateSession, requireAdminRead, csrfProtection, adminHorasExtraRouter);

  const { default: horaJornadaRouter } = await import("./routes/compartido/hora_llegada_salida.js");
  app.use("/horas_jornada", authenticateSession, requireAuthenticatedActor, csrfProtection, horaJornadaRouter);
})();

/**
 * POST /push/test
 * Envía una notificación push de prueba a un trabajador específico identificado por numero_identificacion.
 * @body {{ numero_identificacion: string, title: string, body: string }}
 * @returns {{ success: boolean, message: string }}
 */
app.post("/push/test", authenticateSession, requireAdminRead, csrfProtection, async (req, res) => {
  const { numero_identificacion, title, body } = req.body;
  if (!numero_identificacion || !title || !body) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios (numero_identificacion, title, body)" });
  }
  try {
    const workerRes = await pool.query(
      `SELECT DISTINCT ON (ps.endpoint)
         ps.id,
         ps.endpoint,
         ps.subscription
       FROM trabajadores t
       JOIN push_subscriptions ps ON ps.trabajador_id = t.id
       WHERE t.numero_identificacion = $1
         AND COALESCE(ps.endpoint, '') <> ''
       ORDER BY ps.endpoint, COALESCE(ps.fecha_suscripcion, ps.creado, NOW()) DESC, ps.id DESC`,
      [String(numero_identificacion)]
    );
    if (workerRes.rows.length === 0) {
      return res.status(404).json({ error: "Suscripción no encontrada para ese trabajador" });
    }

    let sent = 0;
    let failed = 0;

    for (const row of workerRes.rows) {
      try {
        await sendPushNotification(row.subscription, {
          title,
          body,
          icon: "https://gruaman-bomberman-front.onrender.com/icon-192.png",
          url: "/"
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        if (isTerminalPushError(err)) {
          await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]).catch(() => {});
        }
      }
    }
    return res.json({ success: true, sent, failed, total: workerRes.rows.length });
  } catch (error) {
    console.error("Error en /push/test:", error);
    return res.status(500).json({ error: "Error interno", detalle: error.message });
  }
});

app.use('/api', authenticateSession, requireAdminRead, csrfProtection, registrosDiariosRouter);
app.use('/administrador/registros_diarios', authenticateSession, requireAdminRead, csrfProtection, registrosDiariosRouter);
app.use('/administrador/indicador_central', authenticateSession, requireAdminRead, csrfProtection, indicadorCentralRouter);
app.use("/administrador", authenticateSession, requireAdminRead, csrfProtection, administradorRouter);
app.use("/permiso_trabajo_admin", authenticateSession, requireAdminRead, csrfProtection, administradorRouter);
app.use("/inspeccion_izaje_admin", authenticateSession, requireGruamanAdmin, csrfProtection, inspeccionIzajeAdminRouter);
app.use("/inspeccion_epcc_admins", authenticateSession, requireGruamanAdmin, csrfProtection, inspeccionEPCCAdminsRouter);
app.use("/chequeo_torregruas_admin", authenticateSession, requireGruamanAdmin, csrfProtection, chequeoTorregruasAdminRouter);
app.use("/chequeo_elevador_admin", authenticateSession, requireGruamanAdmin, csrfProtection, chequeoElevadorAdminRouter);
app.use("/chequeo_alturas_admin", authenticateSession, requireGruamanAdmin, csrfProtection, chequeoAlturasAdminRouter);
app.use("/planilla_bombeo_admin", authenticateSession, requireBombermanAdmin, csrfProtection, planillaBombeoAdminRouter);
app.use("/inventarios_obra_admin", authenticateSession, requireBombermanAdmin, csrfProtection, inventariosObraAdminRouter);
app.use("/inspeccion_epcc_bomberman_admin", authenticateSession, requireBombermanAdmin, csrfProtection, inspeccionEpccBombermanAdminRouter);
app.use("/checklist_admin", authenticateSession, requireBombermanAdmin, csrfProtection, checklistAdminRouter);
app.use("/herramientas_mantenimiento_admin", authenticateSession, requireBombermanAdmin, csrfProtection, herramientasMantenimientoAdminRouter);
app.use("/kit_limpieza_admin", authenticateSession, requireBombermanAdmin, csrfProtection, kitLimpiezaAdminRouter);
app.use("/admin_usuarios", authenticateSession, requireAdminRead, csrfProtection, adminUsuariosRouter);
app.use("/admin_obras", authenticateSession, requireAdminRead, csrfProtection, adminObrasRouter);
// /administrador/admin_horas_extra se monta dentro del IIFE de inicio
app.use("/compartido/permiso_trabajo", authenticateSession, requireAuthenticatedActor, csrfProtection, permisoTrabajoRouter);
app.use("/compartido/chequeo_alturas", authenticateSession, requireAuthenticatedActor, csrfProtection, chequeoAlturasRouter);
app.use("/gruaman/chequeo_torregruas", authenticateSession, requireAuthenticatedActor, csrfProtection, chequeoTorregruasRouter);
app.use("/gruaman/inspeccion_epcc", authenticateSession, requireAuthenticatedActor, csrfProtection, inspeccionEpccRouter);
app.use("/gruaman/inspeccion_izaje", authenticateSession, requireAuthenticatedActor, csrfProtection, inspeccionIzajeRouter);
app.use("/gruaman/chequeo_elevador", authenticateSession, requireAuthenticatedActor, csrfProtection, chequeoElevadorRouter);
app.use("/gruaman/ats", authenticateSession, requireAuthenticatedActor, csrfProtection, atsRouter);
app.use("/bomberman/planillabombeo", authenticateSession, requireAuthenticatedActor, csrfProtection, planillaBombeoRouter);
app.use("/bomberman/checklist", authenticateSession, requireAuthenticatedActor, csrfProtection, checklistRouter);
app.use("/bomberman/inventariosobra", authenticateSession, requireAuthenticatedActor, csrfProtection, inventariosObraRouter);
app.use("/bomberman/inspeccion_epcc_bomberman", authenticateSession, requireAuthenticatedActor, csrfProtection, inspeccionEpccBombermanRouter);
app.use("/bomberman/herramientas_mantenimiento", authenticateSession, requireAuthenticatedActor, csrfProtection, herramientasMantenimientoRouter);
app.use("/bomberman/kit_limpieza", authenticateSession, requireAuthenticatedActor, csrfProtection, kitLimpiezaRouter);
app.use("/sst/pqr", authenticateSession, requireAuthenticatedActor, csrfProtection, pqrRouter);
app.use("/roles/empresas",empresaRouter);

// /horas_jornada se monta dentro del IIFE de inicio

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`API corriendo en http://localhost:${PORT} (PostgreSQL conectado)`)
);

/**
 * GET /nombres_trabajadores
 * Retorna los nombres de todos los trabajadores activos, opcionalmente filtrados por empresa_id.
 * @query {{ empresa_id?: number }}
 * @returns {{ nombres: string[] }}
 */
app.get("/nombres_trabajadores", async (req, res) => {
  try {
    const { empresa_id } = req.query;
    let result;
    if (empresa_id) {
      result = await pool.query(
        `SELECT nombre FROM trabajadores WHERE empresa_id = $1 AND activo = true`,
        [empresa_id]
      );
    } else {
      result = await pool.query(`SELECT nombre FROM trabajadores WHERE activo = true`);
    }
    const nombres = result.rows.map(row => row.nombre);
    res.json({ nombres });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los nombres de trabajadores" });
  }
});

/**
 * POST /datos_basicos
 * Hace upsert de un registro de trabajador. Crea la fila si el trabajador no existe;
 * de lo contrario actualiza empresa_id, obra_id, numero_identificacion y empresa
 * solo cuando los valores almacenados difieren de los de la solicitud entrante.
 * @body {{ nombre: string, empresa: string, empresa_id: number, obra_id: number, numero_identificacion: string }}
 * @returns {{ message: string, trabajadorId: number, nombre: string, empresa: string, empresa_id: number, obra_id: number, numero_identificacion: string }}
 */
app.post("/datos_basicos", authenticateSession, requireAdminRead, csrfProtection, async (req, res) => {
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

/**
 * GET /trabajador_id
 * Resuelve el ID de base de datos de un trabajador coincidiendo los cuatro campos de identidad.
 * @query {{ nombre: string, empresa: string, obra: string, numero_identificacion: string }}
 * @returns {{ trabajadorId: number, nombre: string, empresa: string, obra: string, numero_identificacion: string }}
 */
app.get("/trabajador_id", authenticateSession, requireAuthenticatedActor, csrfProtection, async (req, res) => {
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

/**
 * GET /obras
 * Retorna todas las obras registradas con su constructora, empresa_id y estado activo.
 * @returns {{ obras: Array<{ id: number, nombre_obra: string, constructora: string, empresa_id: number, activa: boolean }> }}
 */
app.get("/obras", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, nombre_obra, constructora, empresa_id, activa FROM obras`);
    res.json({ obras: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las obras" });
  }
});

/**
 * GET /bombas
 * Retorna todos los números de bomba registrados en la tabla bombas.
 * @returns {{ bombas: Array<{ numero_bomba: string }> }}
 */
app.get("/bombas", async (req, res) => {
  try {
    const result = await pool.query(`SELECT numero_bomba FROM bombas`);
    res.json({ bombas: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los números de bomba" });
  }
});

/**
 * POST /validar_ubicacion
 * Valida que una coordenada GPS dada se encuentre dentro de los 500 m de la ubicación registrada de la obra.
 * Las obras que coincidan con la variable de entorno OBRA_BYPASS_NOMBRE omiten la geolocalización por completo.
 * @body {{ obra_id: number, lat: number, lon: number }}
 * @returns {{ ok: boolean, message?: string }}
 */
app.post("/validar_ubicacion", authenticateSession, requireAuthenticatedActor, csrfProtection, async (req, res) => {
  const { obra_id, lat, lon } = req.body;
  if (!obra_id || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ ok: false, message: "Parámetros inválidos" });
  }
  try {
    const OBRA_BYPASS = process.env.OBRA_BYPASS_NOMBRE || "LA CENTRAL";
    const obraCheck = await pool.query(`SELECT nombre_obra FROM obras WHERE id = $1`, [obra_id]);
    if (obraCheck.rows.length > 0 && obraCheck.rows[0].nombre_obra === OBRA_BYPASS) {
      return res.json({ ok: true });
    }

    const result = await pool.query(`SELECT latitud, longitud FROM obras WHERE id = $1`, [obra_id]);
    if (result.rows.length === 0 || result.rows[0].latitud == null || result.rows[0].longitud == null) {
      return res.status(404).json({ ok: false, message: "Obra no encontrada o sin coordenadas" });
    }
    const { latitud, longitud } = result.rows[0];
    const distancia = getDistanceFromLatLonInMeters(lat, lon, latitud, longitud);
    if (distancia <= 500) {
      res.json({ ok: true });
    } else {
      res.status(403).json({ ok: false, distancia: Math.round(distancia), message: "No estás en la ubicación de la obra seleccionada" });
    }
  } catch (error) {
    res.status(500).json({ ok: false, message: "Error al validar ubicación" });
  }
});

/**
 * Calcula la distancia de gran círculo entre dos puntos geográficos usando la fórmula de Haversine.
 * @param {number} lat1 - Latitud del punto 1 en grados decimales.
 * @param {number} lon1 - Longitud del punto 1 en grados decimales.
 * @param {number} lat2 - Latitud del punto 2 en grados decimales.
 * @param {number} lon2 - Longitud del punto 2 en grados decimales.
 * @returns {number} Distancia en metros.
 */
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

/**
 * Convierte grados a radianes.
 * @param {number} deg
 * @returns {number}
 */
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * GET /datos_basicos
 * Retorna los datos de identidad de todos los trabajadores activos, opcionalmente filtrados por empresa_id.
 * @query {{ empresa_id?: number }}
 * @returns {{ datos: Array<{ nombre: string, empresa_id: number, numero_identificacion: string, activo: boolean, cargo: string }> }}
 */
app.get("/datos_basicos", authenticateSession, requireAdminRead, csrfProtection, async (req, res) => {
  try {
    const { empresa_id } = req.query;
    let result;
    if (empresa_id) {
      result = await pool.query(
        `SELECT nombre, empresa_id, numero_identificacion, activo, cargo FROM trabajadores WHERE empresa_id = $1`,
        [empresa_id]
      );
    } else {
      result = await pool.query(
        `SELECT nombre, empresa_id, numero_identificacion, activo, cargo FROM trabajadores`
      );
    }
    res.json({ datos: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los datos básicos de trabajadores" });
  }
});

/**
 * Limitador de tasa en memoria para POST /admin/login.
 * Clave: IP del cliente. Valor: { count: number, resetAt: number }.
 * @type {Map<string, { count: number, resetAt: number }>}
 */
const adminLoginAttempts = new Map();

/**
 * POST /admin/login
 * Autentica a un usuario administrador comparando la contraseña proporcionada contra todos
 * los hashes bcrypt almacenados. Aplica un limitador de tasa en memoria de 10 intentos por IP
 * por ventana de 15 minutos.
 * @body {{ password: string }}
 * @returns {{ success: boolean, rol: string }}
 */
app.post("/admin/login", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Falta la contraseña" });

  const ipKey = req.ip;
  const now = Date.now();
  const adminAttempt = adminLoginAttempts.get(ipKey) || { count: 0, resetAt: now + 15 * 60 * 1000 };  
  if (now > adminAttempt.resetAt) {
    adminAttempt.count = 0;
    adminAttempt.resetAt = now + 15 * 60 * 1000;
  }
  if (adminAttempt.count >= 10) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }
  adminAttempt.count++;
  adminLoginAttempts.set(ipKey, adminAttempt);

  try {
    const result = await pool.query("SELECT id, password_hash, rol FROM admin_passwords");    
    for (const row of result.rows) {
      const match = await bcrypt.compare(password, row.password_hash);
      
      if (match) {
        adminLoginAttempts.delete(ipKey);
        const sessionResult = await authSessionService.issueAdminSession({
          admin: row,
          request: req
        });
        writeAuthCookies(res, authConfig, sessionResult);
        return res.json({
          success: true,
          rol: row.rol,
          authenticated: true,
          user: sessionResult.user,
          session: sessionResult.session,
          csrfToken: sessionResult.csrfToken
        });
      }
    }
    return res.status(401).json({ error: "Error en login, contacte a su Administrador" });
  } catch (error) {
    res.status(500).json({ error: "Error en el login" });
  }
});

/**
 * POST /push/subscribe
 * Registra o actualiza una suscripción Web Push para un trabajador identificado por
 * numero_identificacion. Acepta la suscripción como objeto JSON o como cadena JSON serializada.
 * @body {{ numero_identificacion: string, subscription: object|string }}
 * @returns {{ success: boolean, action: 'upserted', subscriptionId: number|null }}
 */
app.post("/push/subscribe", authenticateSession, requireBodyWorkerSelfOrAdmin, csrfProtection, async (req, res) => {
  const { numero_identificacion, subscription } = req.body;

  if (!numero_identificacion) {
    return res.status(400).json({ error: "Falta numero_identificacion" });
  }
  if (subscription == null) {
    return res.status(400).json({ error: "Falta subscription" });
  }

  let subscriptionObj = subscription;
  if (typeof subscription === "string") {
    try {
      subscriptionObj = JSON.parse(subscription);
    } catch (err) {
      console.error("Subscription string inválida:", subscription);
      return res.status(400).json({ error: "subscription debe ser un objeto JSON o un string JSON válido" });
    }
  }

  if (typeof subscriptionObj !== "object" || Array.isArray(subscriptionObj)) {
    return res.status(400).json({ error: "Formato de subscription inválido" });
  }
  const endpoint = normalizePushEndpoint(subscriptionObj);
  if (!endpoint) {
    return res.status(400).json({ error: "subscription.endpoint es obligatorio" });
  }

  try {
    console.log("POST /push/subscribe payload:", { numero_identificacion, subscription: subscriptionObj });

    const workerRes = await pool.query(
      `SELECT id FROM trabajadores WHERE numero_identificacion = $1`,
      [String(numero_identificacion)]
    );
    if (workerRes.rows.length === 0) {
      return res.status(404).json({ error: "Trabajador no encontrado" });
    }
    const trabajador_id = workerRes.rows[0].id;

    const upsertResult = await pool.query(
      `INSERT INTO push_subscriptions (trabajador_id, endpoint, subscription, fecha_suscripcion)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (trabajador_id, endpoint)
       DO UPDATE
          SET subscription = EXCLUDED.subscription,
              fecha_suscripcion = CURRENT_TIMESTAMP
       RETURNING id`,
      [trabajador_id, endpoint, subscriptionObj]
    );
    return res.json({ success: true, action: "upserted", subscriptionId: upsertResult.rows[0]?.id || null });
  } catch (error) {
    console.error("Error en /push/subscribe:", error);
    res.status(500).json({ error: "Error guardando suscripción", detalle: error.message });
  }
});

/**
 * GET /push/subscribe/schema
 * Retorna una descripción para desarrolladores del payload esperado en POST /push/subscribe.
 * @returns {{ description: string, contentType: string, bodyExample: object, frontendNotes: string[] }}
 */
app.get("/push/subscribe/schema", (req, res) => {
  res.json({
    description: "POST /push/subscribe espera JSON con numero_identificacion y subscription. Hace upsert por (trabajador_id, endpoint).",
    contentType: "application/json",
    bodyExample: {
      numero_identificacion: "12345678",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/....",
        keys: {
          p256dh: "BASE64_P256DH",
          auth: "BASE64_AUTH"
        }
      }
    },
    frontendNotes: [
      "En frontend: const sub = await registration.pushManager.getSubscription();",
      "Enviar fetch(..., { headers: {'Content-Type':'application/json'}, body: JSON.stringify({ numero_identificacion, subscription: sub?.toJSON() }) })",
      "No enviar subscription como stringified JSON dentro de otro string (evitar doble stringify)."
    ]
  });
});

/**
 * Zona horaria usada para todos los cron jobs de notificaciones push programadas.
 * @type {string}
 */
const CRON_TIMEZONE = 'America/Bogota';
const isPushCronEnabled = (() => {
  const configuredValue = process.env.ENABLE_PUSH_CRONS;
  if (typeof configuredValue === 'string') {
    const normalized = configuredValue.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return process.env.NODE_ENV === 'production';
})();

/**
 * Adquiere un bloqueo distribuido por hora mediante la tabla cron_locks antes de ejecutar
 * una tarea programada. Previene ejecuciones duplicadas en múltiples instancias del servidor.
 * Ejecuta sin bloqueo si la tabla cron_locks no existe (código 42P01).
 * @param {string} nombreTarea - Nombre único de la tarea usado como parte de la clave del bloqueo.
 * @param {() => Promise<void>} callback - Trabajo asíncrono a ejecutar bajo el bloqueo.
 * @returns {Promise<void>}
 */
async function ejecutarConLock(nombreTarea, callback) {
  const lockId = `cron_${nombreTarea}_${new Date().toISOString().slice(0,13)}`;
  try {
    const insertResult = await pool.query(
      `INSERT INTO cron_locks (lock_id, created_at) VALUES ($1, NOW()) ON CONFLICT (lock_id) DO NOTHING RETURNING lock_id`,
      [lockId]
    );
    if (insertResult.rowCount !== 1) {
      return false;
    }
    await callback();
    return true;
  } catch (err) {
    if (err.code === '42P01') {
      console.error(`Lock infra unavailable for ${nombreTarea}. Skipping execution to avoid duplicates.`);
    } else {
      console.error(`Error en lock para ${nombreTarea}:`, err.message);
    }
    return false;
  }
}

async function getCurrentPushWindowKey() {
  const result = await pool.query(
    `SELECT to_char((NOW() AT TIME ZONE $1), 'YYYY-MM-DD-HH24') AS window_key`,
    [CRON_TIMEZONE]
  );
  return result.rows[0]?.window_key || new Date().toISOString().slice(0, 13);
}

async function registerPushDispatch({ jobKey, trabajadorId, subscriptionId, endpoint, windowKey }) {
  const result = await pool.query(
    `INSERT INTO push_notification_dispatches (job_key, trabajador_id, subscription_id, endpoint, window_key, status)
     VALUES ($1, $2, $3, $4, $5, 'sent')
     ON CONFLICT (job_key, subscription_id, window_key) DO NOTHING
     RETURNING id`,
    [jobKey, trabajadorId, subscriptionId, endpoint, windowKey]
  );
  return result.rowCount === 1;
}

async function runPushCronJob({ jobKey, title, body, errorLabel }) {
  if (!isPushCronEnabled) {
    console.log(`[push-cron:${jobKey}] skipped because ENABLE_PUSH_CRONS is disabled`);
    return;
  }

  const result = await pool.query(`
    SELECT DISTINCT ON (ps.endpoint, ps.trabajador_id)
      t.id,
      t.nombre,
      ps.id AS subscription_id,
      ps.endpoint,
      ps.subscription
    FROM trabajadores t
    JOIN push_subscriptions ps ON ps.trabajador_id = t.id
    WHERE COALESCE(ps.endpoint, '') <> ''
    ORDER BY ps.endpoint, ps.trabajador_id, COALESCE(ps.fecha_suscripcion, ps.creado, NOW()) DESC, ps.id DESC
  `);
  const windowKey = await getCurrentPushWindowKey();

  for (const row of result.rows) {
    try {
      const canSend = await registerPushDispatch({
        jobKey,
        trabajadorId: row.id,
        subscriptionId: row.subscription_id,
        endpoint: row.endpoint,
        windowKey
      });
      if (!canSend) {
        console.log(`[push-cron:${jobKey}] skipped duplicate for worker ${row.id} subscription ${row.subscription_id} window ${windowKey}`);
        continue;
      }

      await sendPushNotification(row.subscription, {
        title,
        body,
        icon: "https://gruaman-bomberman-front.onrender.com/icon-192.png",
        url: "/"
      });
      console.log(`[push-cron:${jobKey}] sent to worker ${row.id} subscription ${row.subscription_id} window ${windowKey}`);
    } catch (err) {
      if (isTerminalPushError(err)) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.subscription_id]).catch(() => {});
      }
      console.error(`${errorLabel} worker ${row.id}:`, err);
    }
  }
}

cron.schedule('0 0 * * 0,2,3,4,5,6', async () => {
  await ejecutarConLock('indicador_central_diario_0000', async () => {
    try {
      await runIndicadorCentralCutoff({
        corteTipo: 'diario',
        origen: 'cron',
        canal: 'email',
        db: pool
      });
    } catch (err) {
      console.error('Error ejecutando indicador central diario:', err.message);
    }
  });
}, { timezone: CRON_TIMEZONE });

cron.schedule('0 1 1 * *', async () => {
  await ejecutarConLock('indicador_central_mensual_acumulado_01', async () => {
    try {
      await runIndicadorCentralCutoff({
        corteTipo: 'mensual_acumulado',
        origen: 'cron',
        canal: 'email',
        db: pool
      });
    } catch (err) {
      console.error('Error ejecutando indicador central mensual acumulado:', err.message);
    }
  });
}, {timezone: CRON_TIMEZONE})

cron.schedule('30 6 * * 1,2,3,4,5,6', async () => {
  await ejecutarConLock('buenos_dias_630', async () => {
    await runPushCronJob({
      jobKey: 'buenos_dias_630',
      title: "Buenos dias!",
      body: "buenos dias super heroe, no olvides llenar todos tus permisos el dia de hoy",
      errorLabel: "Error enviando notificación 6:30am:"
    });
  });
}, { timezone: CRON_TIMEZONE });

cron.schedule('0 12 * * 1,2,3,4,5,6', async () => {
  await ejecutarConLock('motivacion_1200', async () => {
    await runPushCronJob({
      jobKey: 'motivacion_1200',
      title: "Animo super heroe!",
      body: "hola super heroe, !tu puedes!, hoy es un gran dia para construir una catedral!",
      errorLabel: "Error enviando notificación 12:00md:"
    });
  });
}, { timezone: CRON_TIMEZONE });

/* cron.schedule('0 14 * * *', async () => {
  await ejecutarConLock('seguimiento_1400', async () => {
    await runPushCronJob({
      jobKey: 'seguimiento_1400',
      title: "Como vas?",
      body: "como vas super heroe?, todo marchando",
      errorLabel: "Error enviando notificación 2:00pm:"
    });
  });
}, { timezone: CRON_TIMEZONE }); */

/*cron.schedule('25 15 * * *', async () => {
  await ejecutarConLock('progreso_1525', async () => {
    await runPushCronJob({
      jobKey: 'progreso_1525',
      title: "Hola super heroe!",
      body: "pasamos a recordarte que somos progreso!",
      errorLabel: "Error enviando notificación 3:25pm:"
    });
  });
}, { timezone: CRON_TIMEZONE });*/

cron.schedule('0 17 * * 1,2,3,4,5,6', async () => {
  await ejecutarConLock('cierre_1700', async () => {
    await runPushCronJob({
      jobKey: 'cierre_1700',
      title: "Terminaste?",
      body: "super heroe, ya terminaste todos tus registros?",
      errorLabel: "Error enviando notificación 5:00pm:"
    });
  });
}, { timezone: CRON_TIMEZONE });

/**
 * Forms checked daily at 4:00pm. For each subscribed worker, a notification
 * is sent listing any form that has no matching record for the current date.
 * @type {Array<{ nombre: string, tabla: string }>}
 */
const formularios = [
  { nombre: "registro de horas", tabla: "registros_horas" },
  { nombre: "planilla de bombeo", tabla: "planilla_bombeo" },
  { nombre: "permiso de trabajo", tabla: "permiso_trabajo" },
  { nombre: "chequeo de alturas", tabla: "chequeo_alturas" },
  { nombre: "chequeo de torregruas", tabla: "chequeo_torregruas" },
  { nombre: "inspección EPCC", tabla: "inspeccion_epcc" },
  { nombre: "inspección izaje", tabla: "inspeccion_izaje" },
];

cron.schedule('0 16 * * 1,2,3,4,5,6', async () => {
  await ejecutarConLock('faltantes_1600', async () => {
    if (!isPushCronEnabled) {
      console.log('[push-cron:faltantes_1600] skipped because ENABLE_PUSH_CRONS is disabled');
      return;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const windowKey = await getCurrentPushWindowKey();

    const trabajadores = await pool.query(`
      SELECT DISTINCT ON (ps.endpoint, ps.trabajador_id)
        t.id,
        t.nombre,
        ps.id AS subscription_id,
        ps.endpoint,
        ps.subscription
      FROM trabajadores t
      JOIN push_subscriptions ps ON ps.trabajador_id = t.id
      WHERE COALESCE(ps.endpoint, '') <> ''
      ORDER BY ps.endpoint, ps.trabajador_id, COALESCE(ps.fecha_suscripcion, ps.creado, NOW()) DESC, ps.id DESC
    `);

    for (const row of trabajadores.rows) {
      let faltantes = [];
      for (const form of formularios) {
        let existe = false;
        try {
          const res = await pool.query(
            `SELECT 1 FROM ${form.tabla} WHERE
              (${form.tabla}.trabajador_id = $1 OR
               ${form.tabla}.nombre_operador = $2 OR
               ${form.tabla}.nombre = $2)
              AND fecha_servicio = $3
              LIMIT 1`,
            [row.id, row.nombre, hoy]
          );
          existe = res.rows.length > 0;
        } catch (e) {
          // ignore tables that do not have the expected columns
        }
        if (!existe) faltantes.push(form.nombre);
      }

      if (faltantes.length > 0) {
        try {
          const canSend = await registerPushDispatch({
            jobKey: 'faltantes_1600',
            trabajadorId: row.id,
            subscriptionId: row.subscription_id,
            endpoint: row.endpoint,
            windowKey
          });
          if (!canSend) {
            console.log(`[push-cron:faltantes_1600] skipped duplicate for worker ${row.id} subscription ${row.subscription_id} window ${windowKey}`);
            continue;
          }
          await sendPushNotification(row.subscription, {
            title: "Atencion super heroe!",
            body: `super heroe, te falta ${faltantes.join(", ")} por llenar, !llenalo, tu puedes!`,
            icon: "https://gruaman-bomberman-front.onrender.com/icon-192.png",
            url: "/"
          });
          console.log(`[push-cron:faltantes_1600] sent to worker ${row.id} subscription ${row.subscription_id} window ${windowKey}`);
        } catch (err) {
          if (isTerminalPushError(err)) {
            await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.subscription_id]).catch(() => {});
          }
          console.error(`Error enviando notificación 4:00pm worker ${row.id}:`, err);
        }
      }
    }
  });
}, { timezone: CRON_TIMEZONE });

/**
 * GET /vapid-public-key
 * Retorna la clave pública VAPID como texto plano para uso en la llamada
 * PushManager.subscribe() del navegador.
 * @returns {string}
 */
app.get('/vapid-public-key', (req, res) => {
  res.type('text/plain').send(process.env.VAPID_PUBLIC_KEY);
});
