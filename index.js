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
import inventariosObraRouter from "./routes/bomberman/inventariosobra.js";
import inspeccionEpccBombermanRouter from "./routes/bomberman/inspeccion_epcc_bomberman.js";
import fetch from 'node-fetch'; // Si usas Node < 18, instala: npm install node-fetch

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lista_chequeo (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      bomba_numero VARCHAR(20) NOT NULL,
      horometro_motor VARCHAR(20) NOT NULL,
      chasis_aceite_motor VARCHAR(10) CHECK (chasis_aceite_motor IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_aceite_motor_observacion TEXT,
      chasis_funcionamiento_combustible VARCHAR(10) CHECK (chasis_funcionamiento_combustible IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_funcionamiento_combustible_observacion TEXT,
      chasis_nivel_refrigerante VARCHAR(10) CHECK (chasis_nivel_refrigerante IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_nivel_refrigerante_observacion TEXT,
      chasis_nivel_aceite_hidraulicos VARCHAR(10) CHECK (chasis_nivel_aceite_hidraulicos IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_nivel_aceite_hidraulicos_observacion TEXT,
      chasis_presion_llantas VARCHAR(10) CHECK (chasis_presion_llantas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_presion_llantas_observacion TEXT,
      chasis_fugas VARCHAR(10) CHECK (chasis_fugas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_fugas_observacion TEXT,
      chasis_soldadura VARCHAR(10) CHECK (chasis_soldadura IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_soldadura_observacion TEXT,
      chasis_integridad_cubierta VARCHAR(10) CHECK (chasis_integridad_cubierta IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_integridad_cubierta_observacion TEXT,
      chasis_herramientas_productos_diversos VARCHAR(10) CHECK (chasis_herramientas_productos_diversos IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_herramientas_productos_diversos_observacion TEXT,
      chasis_sistema_alberca VARCHAR(10) CHECK (chasis_sistema_alberca IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_sistema_alberca_observacion TEXT,
      chasis_filtro_hidraulico VARCHAR(10) CHECK (chasis_filtro_hidraulico IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_filtro_hidraulico_observacion TEXT,
      chasis_filtro_agua_limpio VARCHAR(10) CHECK (chasis_filtro_agua_limpio IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_filtro_agua_limpio_observacion TEXT,
      chasis_nivel_agua VARCHAR(10) CHECK (chasis_nivel_agua IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      chasis_nivel_agua_observacion TEXT,
      anillos VARCHAR(10) CHECK (anillos IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      anillos_observacion TEXT,
      anillos_desgaste VARCHAR(10) CHECK (anillos_desgaste IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      anillos_desgaste_observacion TEXT,
      placa_gafa VARCHAR(10) CHECK (placa_gafa IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      placa_gafa_observacion TEXT,
      cilindros_atornillados VARCHAR(10) CHECK (cilindros_atornillados IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      cilindros_atornillados_observacion TEXT,
      paso_masilla VARCHAR(10) CHECK (paso_masilla IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      paso_masilla_observacion TEXT,
      paso_agua VARCHAR(10) CHECK (paso_agua IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      paso_agua_observacion TEXT,
      partes_faltantes VARCHAR(10) CHECK (partes_faltantes IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      partes_faltantes_observacion TEXT,
      mecanismo_s VARCHAR(10) CHECK (mecanismo_s IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      mecanismo_s_observacion TEXT,
      funcion_sensor VARCHAR(10) CHECK (funcion_sensor IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      funcion_sensor_observacion TEXT,
      estado_oring VARCHAR(10) CHECK (estado_oring IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      estado_oring_observacion TEXT,
      funcion_vibrador VARCHAR(10) CHECK (funcion_vibrador IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      funcion_vibrador_observacion TEXT,
      paletas_eje_agitador VARCHAR(10) CHECK (paletas_eje_agitador IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      paletas_eje_agitador_observacion TEXT,
      motor_accionamiento VARCHAR(10) CHECK (motor_accionamiento IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      motor_accionamiento_observacion TEXT,
      valvula_control VARCHAR(10) CHECK (valvula_control IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      valvula_control_observacion TEXT,
      hidraulico_fugas VARCHAR(10) CHECK (hidraulico_fugas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_fugas_observacion TEXT,
      hidraulico_cilindros_botellas_estado VARCHAR(10) CHECK (hidraulico_cilindros_botellas_estado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_cilindros_botellas_estado_observacion TEXT,
      hidraulico_indicador_nivel_aceite VARCHAR(10) CHECK (hidraulico_indicador_nivel_aceite IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_indicador_nivel_aceite_observacion TEXT,
      hidraulico_enfriador_termotasto VARCHAR(10) CHECK (hidraulico_enfriador_termotasto IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_enfriador_termotasto_observacion TEXT,
      hidraulico_indicador_filtro VARCHAR(10) CHECK (hidraulico_indicador_filtro IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_indicador_filtro_observacion TEXT,
      hidraulico_limalla VARCHAR(10) CHECK (hidraulico_limalla IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_limalla_observacion TEXT,
      hidraulico_mangueras_tubos_sin_fugas VARCHAR(10) CHECK (hidraulico_mangueras_tubos_sin_fugas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      hidraulico_mangueras_tubos_sin_fugas_observacion TEXT,
      superficie_nivel_deposito_grasa VARCHAR(10) CHECK (superficie_nivel_deposito_grasa IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      superficie_nivel_deposito_grasa_observacion TEXT,
      superficie_puntos_lubricacion VARCHAR(10) CHECK (superficie_puntos_lubricacion IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      superficie_puntos_lubricacion_observacion TEXT,
      superficie_empaquetaduras_conexion VARCHAR(10) CHECK (superficie_empaquetaduras_conexion IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      superficie_empaquetaduras_conexion_observacion TEXT,
      superficie_fugas VARCHAR(10) CHECK (superficie_fugas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      superficie_fugas_observacion TEXT,
      mangueras_interna_no_deshilachadas VARCHAR(10) CHECK (mangueras_interna_no_deshilachadas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      mangueras_interna_no_deshilachadas_observacion TEXT,
      mangueras_acoples_buen_estado VARCHAR(10) CHECK (mangueras_acoples_buen_estado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      mangueras_acoples_buen_estado_observacion TEXT,
      mangueras_externa_no_deshilachado VARCHAR(10) CHECK (mangueras_externa_no_deshilachado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      mangueras_externa_no_deshilachado_observacion TEXT,
      electrico_interruptores_buen_estado VARCHAR(10) CHECK (electrico_interruptores_buen_estado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_interruptores_buen_estado_observacion TEXT,
      electrico_luces_funcionan VARCHAR(10) CHECK (electrico_luces_funcionan IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_luces_funcionan_observacion TEXT,
      electrico_cubiertas_proteccion_buenas VARCHAR(10) CHECK (electrico_cubiertas_proteccion_buenas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_cubiertas_proteccion_buenas_observacion TEXT,
      electrico_cordon_mando_buen_estado VARCHAR(10) CHECK (electrico_cordon_mando_buen_estado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_cordon_mando_buen_estado_observacion TEXT,
      electrico_interruptores_emergencia_funcionan VARCHAR(10) CHECK (electrico_interruptores_emergencia_funcionan IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_interruptores_emergencia_funcionan_observacion TEXT,
      electrico_conexiones_sin_oxido VARCHAR(10) CHECK (electrico_conexiones_sin_oxido IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_conexiones_sin_oxido_observacion TEXT,
      electrico_paros_emergencia VARCHAR(10) CHECK (electrico_paros_emergencia IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_paros_emergencia_observacion TEXT,
      electrico_aisladores_cables_buenos VARCHAR(10) CHECK (electrico_aisladores_cables_buenos IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      electrico_aisladores_cables_buenos_observacion TEXT,
      tuberia_abrazaderas_codos_ajustadas VARCHAR(10) CHECK (tuberia_abrazaderas_codos_ajustadas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_abrazaderas_codos_ajustadas_observacion TEXT,
      tuberia_bujia_tallo_anclados VARCHAR(10) CHECK (tuberia_bujia_tallo_anclados IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_bujia_tallo_anclados_observacion TEXT,
      tuberia_abrazaderas_descarga_ajustadas VARCHAR(10) CHECK (tuberia_abrazaderas_descarga_ajustadas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_abrazaderas_descarga_ajustadas_observacion TEXT,
      tuberia_espesor VARCHAR(10) CHECK (tuberia_espesor IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_espesor_observacion TEXT,
      tuberia_vertical_tallo_recta VARCHAR(10) CHECK (tuberia_vertical_tallo_recta IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_vertical_tallo_recta_observacion TEXT,
      tuberia_desplazamiento_seguro VARCHAR(10) CHECK (tuberia_desplazamiento_seguro IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      tuberia_desplazamiento_seguro_observacion TEXT,
      equipo_limpio VARCHAR(10) CHECK (equipo_limpio IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      equipo_limpio_observacion TEXT,
      orden_aseo VARCHAR(10) CHECK (orden_aseo IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      orden_aseo_observacion TEXT,
      delimitacion_etiquetado VARCHAR(10) CHECK (delimitacion_etiquetado IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      delimitacion_etiquetado_observacion TEXT,
      permisos VARCHAR(10) CHECK (permisos IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      permisos_observacion TEXT,
      extintores VARCHAR(10) CHECK (extintores IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      extintores_observacion TEXT,
      botiquin VARCHAR(10) CHECK (botiquin IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      botiquin_observacion TEXT,
      arnes_eslinga VARCHAR(10) CHECK (arnes_eslinga IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      arnes_eslinga_observacion TEXT,
      dotacion VARCHAR(10) CHECK (dotacion IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      dotacion_observacion TEXT,
      epp VARCHAR(10) CHECK (epp IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      epp_observacion TEXT,
      rotulacion VARCHAR(10) CHECK (rotulacion IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      rotulacion_observacion TEXT,
      matriz_compatibilidad VARCHAR(10) CHECK (matriz_compatibilidad IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      matriz_compatibilidad_observacion TEXT,
      demarcacion_bomba VARCHAR(10) CHECK (demarcacion_bomba IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      demarcacion_bomba_observacion TEXT,
      orden_aseo_concreto VARCHAR(10) CHECK (orden_aseo_concreto IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      orden_aseo_concreto_observacion TEXT,
      epp_operario_auxiliar VARCHAR(10) CHECK (epp_operario_auxiliar IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      epp_operario_auxiliar_observacion TEXT,
      kit_mantenimiento VARCHAR(10) CHECK (kit_mantenimiento IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      kit_mantenimiento_observacion TEXT,
      combustible VARCHAR(10) CHECK (combustible IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      combustible_observacion TEXT,
      horas_motor VARCHAR(10) CHECK (horas_motor IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      horas_motor_observacion TEXT,
      grasa VARCHAR(10) CHECK (grasa IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      grasa_observacion TEXT,
      planillas VARCHAR(10) CHECK (planillas IN ('BUENO', 'REGULAR', 'MALO')) NOT NULL,
      planillas_observacion TEXT,
      observaciones TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventario_obra (
      id SERIAL PRIMARY KEY,
      cliente_constructora           VARCHAR(100) NOT NULL,
      proyecto_constructora          VARCHAR(100) NOT NULL,
      fecha_registro                 DATE NOT NULL,
      nombre_operador                VARCHAR(100) NOT NULL,
      cargo_operador                 VARCHAR(100) NOT NULL,
      bola_limpieza_tuberia_55_cifa  NUMERIC NOT NULL,
      jostick NUMERIC NOT NULL,
      inyector_grasa NUMERIC NOT NULL,
      caja_herramientas NUMERIC NOT NULL,
      tubo_entrega_50cm_flanche_plano NUMERIC NOT NULL,
      caneca_5_galones NUMERIC NOT NULL,
      caneca_55_galones NUMERIC NOT NULL,
      pimpinas_5_6_galones NUMERIC NOT NULL,
      manguera_bicolor NUMERIC NOT NULL,
      juego_llaves_x3_piezas NUMERIC NOT NULL,
      pinza_picolor NUMERIC NOT NULL,
      bristol_14mm NUMERIC NOT NULL,
      bristol_12mm NUMERIC NOT NULL,
      juego_llaves_bristol_x9 NUMERIC NOT NULL,
      cortafrio NUMERIC NOT NULL,
      pinzas_punta NUMERIC NOT NULL,
      llave_expansiva_15 NUMERIC NOT NULL,
      maseta NUMERIC NOT NULL,
      tubo_para_abrazadera NUMERIC NOT NULL,
      llave_11 NUMERIC NOT NULL,
      llave_10 NUMERIC NOT NULL,
      llave_13 NUMERIC NOT NULL,
      llave_14 NUMERIC NOT NULL,
      llave_17 NUMERIC NOT NULL,
      llave_19 NUMERIC NOT NULL,
      llave_22 NUMERIC NOT NULL,
      llave_24 NUMERIC NOT NULL,
      llave_27 NUMERIC NOT NULL,
      llave_30 NUMERIC NOT NULL,
      llave_32 NUMERIC NOT NULL,
      destornillador_pala_65x125mm NUMERIC NOT NULL,
      destornillador_pala_8x150mm NUMERIC NOT NULL,
      destornillador_pala_55x125mm NUMERIC NOT NULL,
      destornillador_estrella_ph3x150mm NUMERIC NOT NULL,
      destornillador_estrella_ph2x100mm NUMERIC NOT NULL,
      destornillador_estrella_ph3x75mm NUMERIC NOT NULL,
      cunete_grasa_5_galones NUMERIC NOT NULL,
      bomba_concreto_pc506_309_cifa_estado VARCHAR(10) CHECK (bomba_concreto_pc506_309_cifa_estado IN ('BUENA','MALA')) NOT NULL,
      bomba_concreto_pc506_309_cifa_observacion TEXT,
      bomba_concreto_pc607_411_cifa_estado VARCHAR(10) CHECK (bomba_concreto_pc607_411_cifa_estado IN ('BUENA','MALA')) NOT NULL,
      bomba_concreto_pc607_411_cifa_observacion TEXT,
      bomba_concreto_tb30_turbosol_estado VARCHAR(10) CHECK (bomba_concreto_tb30_turbosol_estado IN ('BUENA','MALA')) NOT NULL,
      bomba_concreto_tb30_turbosol_observacion TEXT,
      bomba_concreto_tb50_turbosol_estado VARCHAR(10) CHECK (bomba_concreto_tb50_turbosol_estado IN ('BUENA','MALA')) NOT NULL,
      bomba_concreto_tb50_turbosol_observacion TEXT,
      tubo_3mt_flanche_plano_estado VARCHAR(10) CHECK (tubo_3mt_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      tubo_3mt_flanche_plano_observacion TEXT,
      tubo_2mt_flanche_plano_estado VARCHAR(10) CHECK (tubo_2mt_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      tubo_2mt_flanche_plano_observacion TEXT,
      tubo_1mt_flanche_plano_estado VARCHAR(10) CHECK (tubo_1mt_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      tubo_1mt_flanche_plano_observacion TEXT,
      abrazadera_3_pulg_flanche_plano_estado VARCHAR(10) CHECK (abrazadera_3_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      abrazadera_3_pulg_flanche_plano_observacion TEXT,
      empaque_3_pulg_flanche_plano_estado VARCHAR(10) CHECK (empaque_3_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      empaque_3_pulg_flanche_plano_observacion TEXT,
      abrazadera_4_pulg_flanche_plano_estado VARCHAR(10) CHECK (abrazadera_4_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      abrazadera_4_pulg_flanche_plano_observacion TEXT,
      empaque_4_pulg_flanche_plano_estado VARCHAR(10) CHECK (empaque_4_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      empaque_4_pulg_flanche_plano_observacion TEXT,
      abrazadera_5_pulg_flanche_plano_estado VARCHAR(10) CHECK (abrazadera_5_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      abrazadera_5_pulg_flanche_plano_observacion TEXT,
      empaque_5_pulg_flanche_plano_estado VARCHAR(10) CHECK (empaque_5_pulg_flanche_plano_estado IN ('BUENA','MALA')) NOT NULL,
      empaque_5_pulg_flanche_plano_observacion TEXT,
      codo_45_r1000_5_pulg_flanche_estado VARCHAR(10) CHECK (codo_45_r1000_5_pulg_flanche_estado IN ('BUENA','MALA')) NOT NULL,
      codo_45_r1000_5_pulg_flanche_observacion TEXT,
      codo_90_r500_5_pulg_flanche_estado VARCHAR(10) CHECK (codo_90_r500_5_pulg_flanche_estado IN ('BUENA','MALA')) NOT NULL,
      codo_90_r500_5_pulg_flanche_observacion  TEXT,
      codo_salida_6_pulg_turbosol_estado VARCHAR(10) CHECK (codo_salida_6_pulg_turbosol_estado IN ('BUENA','MALA')) NOT NULL,
      codo_salida_6_pulg_turbosol_observacion  TEXT,
      manguera_3_pulg_x10mt_estado VARCHAR(10) CHECK (manguera_3_pulg_x10mt_estado IN ('BUENA','MALA')) NOT NULL,
      manguera_3_pulg_x10mt_observacion        TEXT,
      manguera_5_pulg_x6mt_estado VARCHAR(10) CHECK (manguera_5_pulg_x6mt_estado IN ('BUENA','MALA')) NOT NULL,
      manguera_5_pulg_x6mt_observacion TEXT,
      reduccion_5_a_4_pulg_estado VARCHAR(10) CHECK (reduccion_5_a_4_pulg_estado IN ('BUENA','MALA')) NOT NULL,
      reduccion_5_a_4_pulg_observacion TEXT,
      valvula_guillotina_55_estado VARCHAR(10) CHECK (valvula_guillotina_55_estado IN ('BUENA','MALA')) NOT NULL,
      valvula_guillotina_55_observacion TEXT,
      extintor_estado VARCHAR(10) CHECK (extintor_estado IN ('BUENA','MALA')) NOT NULL,
      extintor_observacion TEXT,
      botiquin_estado VARCHAR(10) CHECK (botiquin_estado IN ('BUENA','MALA')) NOT NULL,
      botiquin_observacion TEXT,
      observaciones_generales TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inspeccion_epcc_bomberman (
      id SERIAL PRIMARY KEY,
      cliente_constructora VARCHAR(100) NOT NULL,
      proyecto_constructora VARCHAR(100) NOT NULL,
      fecha_registro DATE NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      cargo_operador VARCHAR(100) NOT NULL,
      sintoma_malestar_fisico VARCHAR(10) CHECK (sintoma_malestar_fisico IN ('SI','NO','NA')) NOT NULL,
      uso_medicamentos_que_afecten_alerta VARCHAR(10) CHECK (uso_medicamentos_que_afecten_alerta IN ('SI','NO','NA')) NOT NULL,
      consumo_sustancias_12h VARCHAR(10) CHECK (consumo_sustancias_12h IN ('SI','NO','NA')) NOT NULL,
      condiciones_fisicas_tareas_criticas VARCHAR(10) CHECK (condiciones_fisicas_tareas_criticas IN ('SI','NO','NA')) NOT NULL,
      competencia_vigente_tarea_critica VARCHAR(10) CHECK (competencia_vigente_tarea_critica IN ('SI','NO','NA')) NOT NULL,
      proteccion_cabeza_buen_estado VARCHAR(10) CHECK (proteccion_cabeza_buen_estado IN ('SI','NO','NA')) NOT NULL,
      proteccion_auditiva_buen_estado VARCHAR(10) CHECK (proteccion_auditiva_buen_estado IN ('SI','NO','NA')) NOT NULL,
      proteccion_visual_buen_estado VARCHAR(10) CHECK (proteccion_visual_buen_estado IN ('SI','NO','NA')) NOT NULL,
      proteccion_respiratoria_buen_estado VARCHAR(10) CHECK (proteccion_respiratoria_buen_estado IN ('SI','NO','NA')) NOT NULL,
      guantes_proteccion_buen_estado VARCHAR(10) CHECK (guantes_proteccion_buen_estado IN ('SI','NO','NA')) NOT NULL,
      ropa_trabajo_buen_estado VARCHAR(10) CHECK (ropa_trabajo_buen_estado IN ('SI','NO','NA')) NOT NULL,
      botas_seguridad_buen_estado VARCHAR(10) CHECK (botas_seguridad_buen_estado IN ('SI','NO','NA')) NOT NULL,
      otros_epp_buen_estado VARCHAR(10) CHECK (otros_epp_buen_estado IN ('SI','NO','NA')) NOT NULL,
      etiqueta_en_buen_estado VARCHAR(10) CHECK (etiqueta_en_buen_estado IN ('SI','NO','NA')) NOT NULL,
      compatibilidad_sistema_proteccion VARCHAR(10) CHECK (compatibilidad_sistema_proteccion IN ('SI','NO','NA')) NOT NULL,
      absorbedor_impacto_buen_estado VARCHAR(10) CHECK (absorbedor_impacto_buen_estado IN ('SI','NO','NA')) NOT NULL,
      cintas_tiras_buen_estado VARCHAR(10) CHECK (cintas_tiras_buen_estado IN ('SI','NO','NA')) NOT NULL,
      costuras_buen_estado VARCHAR(10) CHECK (costuras_buen_estado IN ('SI','NO','NA')) NOT NULL,
      indicadores_impacto_buen_estado VARCHAR(10) CHECK (indicadores_impacto_buen_estado IN ('SI','NO','NA')) NOT NULL,
      partes_metalicas_buen_estado VARCHAR(10) CHECK (partes_metalicas_buen_estado IN ('SI','NO','NA')) NOT NULL,
      sistema_cierre_automatico_buen_estado VARCHAR(10) CHECK (sistema_cierre_automatico_buen_estado IN ('SI','NO','NA')) NOT NULL,
      palanca_multifuncional_buen_funcionamiento VARCHAR(10) CHECK (palanca_multifuncional_buen_funcionamiento IN ('SI','NO','NA')) NOT NULL,
      estrias_leva_libres_dano VARCHAR(10) CHECK (estrias_leva_libres_dano IN ('SI','NO','NA')) NOT NULL,
      partes_plasticas_buen_estado VARCHAR(10) CHECK (partes_plasticas_buen_estado IN ('SI','NO','NA')) NOT NULL,
      guarda_cabos_funda_alma_buen_estado VARCHAR(10) CHECK (guarda_cabos_funda_alma_buen_estado IN ('SI','NO','NA')) NOT NULL,
      herramientas_libres_danos_visibles VARCHAR(10) CHECK (herramientas_libres_danos_visibles IN ('SI','NO','NA')) NOT NULL,
      mangos_facil_agarre VARCHAR(10) CHECK (mangos_facil_agarre IN ('SI','NO','NA')) NOT NULL,
      herramientas_afiladas_ajustadas VARCHAR(10) CHECK (herramientas_afiladas_ajustadas IN ('SI','NO','NA')) NOT NULL,
      herramientas_disenadas_tarea VARCHAR(10) CHECK (herramientas_disenadas_tarea IN ('SI','NO','NA')) NOT NULL,
      herramientas_dimensiones_correctas VARCHAR(10) CHECK (herramientas_dimensiones_correctas IN ('SI','NO','NA')) NOT NULL,
      seguetas_bien_acopladas VARCHAR(10) CHECK (seguetas_bien_acopladas IN ('SI','NO','NA')) NOT NULL,
      pinzas_buen_funcionamiento VARCHAR(10) CHECK (pinzas_buen_funcionamiento IN ('SI','NO','NA')) NOT NULL,
      aislamiento_dieletrico_buen_estado VARCHAR(10) CHECK (aislamiento_dieletrico_buen_estado IN ('SI','NO','NA')) NOT NULL,
      apaga_equipo_para_cambio_discos VARCHAR(10) CHECK (apaga_equipo_para_cambio_discos IN ('SI','NO','NA')) NOT NULL,
      uso_llaves_adecuadas_cambio_discos VARCHAR(10) CHECK (uso_llaves_adecuadas_cambio_discos IN ('SI','NO','NA')) NOT NULL,
      discos_brocas_puntas_buen_estado VARCHAR(10) CHECK (discos_brocas_puntas_buen_estado IN ('SI','NO','NA')) NOT NULL,
      rpm_no_supera_capacidad_disco VARCHAR(10) CHECK (rpm_no_supera_capacidad_disco IN ('SI','NO','NA')) NOT NULL,
      cables_aislamiento_doble_buen_estado VARCHAR(10) CHECK (cables_aislamiento_doble_buen_estado IN ('SI','NO','NA')) NOT NULL,
      conexiones_neumaticas_seguras VARCHAR(10) CHECK (conexiones_neumaticas_seguras IN ('SI','NO','NA')) NOT NULL,
      mangueras_y_equipos_sin_fugas VARCHAR(10) CHECK (mangueras_y_equipos_sin_fugas IN ('SI','NO','NA')) NOT NULL,
      piezas_ajustadas_correctamente VARCHAR(10) CHECK (piezas_ajustadas_correctamente IN ('SI','NO','NA')) NOT NULL,
      tubo_escape_con_guarda_silenciador VARCHAR(10) CHECK (tubo_escape_con_guarda_silenciador IN ('SI','NO','NA')) NOT NULL,
      guayas_pasadores_buen_estado VARCHAR(10) CHECK (guayas_pasadores_buen_estado IN ('SI','NO','NA')) NOT NULL,
      observaciones_generales TEXT
    );
  `);

  // Tabla para registrar llamadas a la API de WhatsApp (debug)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_logs (
      id SERIAL PRIMARY KEY,
      phone_number_id VARCHAR(50),
      destinatario VARCHAR(50),
      request_body JSONB,
      response_status INT,
      response_headers JSONB,
      response_body JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
app.use("/bomberman/inventariosobra", inventariosObraRouter);
app.use("/bomberman/inspeccion_epcc_bomberman", inspeccionEpccBombermanRouter);

app.listen(3000, () =>
  console.log("✅ API corriendo en http://localhost:3000 (PostgreSQL conectado)")
);

// Devuelve los datos básicos de todos los trabajadores
app.get("/datos_basicos", async (req, res) => {
  try {
    const result = await pool.query(`SELECT nombre, empresa_id, numero_identificacion FROM trabajadores`);
    res.json({ datos: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los datos básicos de trabajadores" });
  }
});

// Reemplazar el handler existente por uno que reexponga status/headers/body de la WA API
app.post('/api/emergencia', async (req, res) => {
  try {
    const { usuario, ubicacion } = req.body;

    // Preferir variables de entorno en producción
    //    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID || '1341362294035680';
    //    const token = process.env.WA_TOKEN || 'EAAmE8C4xTwgBP9jYXdgLTGF44YudZAcOdnDoRwV9TaqZAuJZBpsPchZAMZAtrbw6GEIjZCSZCAYLOmpNwnAZAhKUKuMnkzeTrdD6b5HRZBXF2ZBnj1yY7xYiZCgOtyvHySdvvs8lBhad0mhbsEAZBurQEKyTcuUsJPIfsCO3OZAPNXvjA9RqcloSWZBnmlgQaJWk3NVr75LjXUhNFnyaKWAiZBMJDKuFWRk6CvkMUbtiBV8vdNWZCXVuWAZDZD';
    //    const destinatario = process.env.WA_DESTINATARIO || '573043660371';
    // phoneNumberId = "Identificador de número de teléfono" (no el id de la cuenta)
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID || '860177043826159';
    const token = process.env.WA_TOKEN || 'EAAmE8C4xTwgBP5dIjWzYNzQBthQeJvY4X9K8CklaC5y0ZBGSaA72d2dcgZAu090ZAEx3Uz0B9hFZAYdDvOuOpQZAzwpGZAp6mfRpJU0y2CCt32lGPFG2b2WG1r6ZBoqYkiTDmXsHAgZAXqCC4FxVUPZCGo9dZCa25XNyTsWI4xFR47hoT3kxAiWe58ZBoy3KInk5eUswHfp2XUvuMoOluZCuWELLGbnbHWYctBbGhf60xvyTUmbntwZDZD';
    const destinatario = process.env.WA_DESTINATARIO || '573043660371';

    const mensaje = `🚨 EMERGENCIA 🚨\nUsuario: ${usuario}\nUbicación: ${ubicacion || 'me encuentro en apuros'}`;

    let response;
    try {
      response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destinatario,
          type: 'text',
          text: { body: mensaje },
        }),
      });
    } catch (networkErr) {
      console.error('Network error calling WhatsApp API:', networkErr);
      return res.status(502).json({ success: false, message: 'Network error contacting WhatsApp API', error: networkErr.message });
    }

    const rawText = await response.text();
    let result;
    try { result = JSON.parse(rawText); } catch (e) { result = { raw: rawText }; }

    const headersObj = Object.fromEntries(response.headers.entries());

    // Guardar log en BD (no bloqueante para la respuesta)
    try {
      const insert = await pool.query(
        `INSERT INTO wa_logs (phone_number_id, destinatario, request_body, response_status, response_headers, response_body)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          phoneNumberId,
          destinatario,
          { usuario, ubicacion, mensaje },
          response.status,
          headersObj,
          result,
        ]
      );
      const logId = insert.rows[0]?.id;
      console.log('WA log saved id=', logId);
    } catch (logErr) {
      console.error('Error guardando log WA en BD:', logErr);
    }

    console.log('WA API status:', response.status, response.statusText);
    console.log('WA API headers:', headersObj);
    console.log('WA API body:', result);

    // Manejo específico para GraphMethodException / subcode 33 (ID inválido / permisos)
    if (result && result.error) {
      const err = result.error;
      if (err.type === 'GraphMethodException' && err.code === 100 && err.error_subcode === 33) {
        return res.status(400).json({
          success: false,
          message: 'El phoneNumberId parece incorrecto o no tiene permisos.',
          help: 'WA_PHONE_NUMBER_ID debe ser el "Phone number ID" del número de WhatsApp Business (no el ID de la app o negocio).',
          action: 'Revisa Business Manager → WhatsApp → Phone numbers y usa el Phone number ID. Asegura que el token tenga permisos y que el número esté habilitado.',
          suppliedPhoneNumberId: phoneNumberId,
          waError: err
        });
      }

      // Responder el error original si no es el caso anterior
      return res.status(response.status || 400).json({
        success: false,
        message: 'Error de la API de WhatsApp (ver waBody)',
        waBody: result
      });
    }

    // Caso OK: devolver resultado
    return res.status(200).json({
      success: true,
      message: 'Mensaje aceptado por la API de WhatsApp',
      waResult: result,
      waHeaders: headersObj
    });

  } catch (error) {
    console.error('Error al enviar mensaje WhatsApp:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para consultar logs de WhatsApp (limit opcional)
app.get('/wa/logs', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const result = await pool.query(`SELECT * FROM wa_logs ORDER BY id DESC LIMIT $1`, [limit]);
    res.json({ logs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener logs de WhatsApp' });
  }
});
