-- Migración 001: Tabla para Análisis de Trabajo Seguro (ATS) de Gruaman
-- Fecha: 2026-03-16
-- Descripción: Registra los ATS por tipo de operación (torre grúa, mando inalámbrico, etc.)

-- UP
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

  -- RIESGOS FÍSICOS
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

  -- RIESGOS QUÍMICOS
  riesgo_aerosol              BOOLEAN DEFAULT FALSE,
  riesgo_polvos               BOOLEAN DEFAULT FALSE,
  riesgo_vapores              BOOLEAN DEFAULT FALSE,

  -- RIESGOS ERGONÓMICOS
  riesgo_sobre_esfuerzo       BOOLEAN DEFAULT FALSE,
  riesgo_posturas_incomodas   BOOLEAN DEFAULT FALSE,
  riesgo_posturas_estaticas   BOOLEAN DEFAULT FALSE,
  riesgo_movimientos_repetitivos BOOLEAN DEFAULT FALSE,

  -- RIESGO PSICOSOCIAL
  riesgo_psicosocial          BOOLEAN DEFAULT FALSE,

  -- RIESGOS NATURALES
  riesgo_naturales            BOOLEAN DEFAULT FALSE,

  -- RIESGOS LOCATIVOS
  riesgo_caida_mismo_nivel    BOOLEAN DEFAULT FALSE,
  riesgo_caida_distinto_nivel BOOLEAN DEFAULT FALSE,
  riesgo_caida_objetos        BOOLEAN DEFAULT FALSE,
  riesgo_cambio_temperatura   BOOLEAN DEFAULT FALSE,
  riesgo_desprendimiento      BOOLEAN DEFAULT FALSE,
  riesgo_hundimientos         BOOLEAN DEFAULT FALSE,
  riesgo_atropellamiento      BOOLEAN DEFAULT FALSE,

  -- RIESGOS MECÁNICOS
  riesgo_golpes_machacones    BOOLEAN DEFAULT FALSE,
  riesgo_atrapamientos        BOOLEAN DEFAULT FALSE,
  riesgo_mecanismos_movimiento BOOLEAN DEFAULT FALSE,
  riesgo_proyeccion_particulas BOOLEAN DEFAULT FALSE,
  riesgo_choques              BOOLEAN DEFAULT FALSE,
  riesgo_espacios_reducidos   BOOLEAN DEFAULT FALSE,
  riesgo_cortes_herramienta   BOOLEAN DEFAULT FALSE,
  riesgo_caida_objetos_mec    BOOLEAN DEFAULT FALSE,

  -- RIESGOS BIOLÓGICOS
  riesgo_bacterias_virus      BOOLEAN DEFAULT FALSE,
  riesgo_picadura_insectos    BOOLEAN DEFAULT FALSE,
  riesgo_ofidio               BOOLEAN DEFAULT FALSE,
  riesgo_mordedura_caninos    BOOLEAN DEFAULT FALSE,

  -- EQUIPOS Y HERRAMIENTAS
  herramientas_manuales       TEXT,
  herramientas_electricas     TEXT,
  herramientas_neumaticas     TEXT,
  herramientas_hidraulicas    TEXT,
  herramientas_mecanicas      TEXT,
  herramientas_otras          TEXT,

  -- EPP (ELEMENTOS DE PROTECCIÓN PERSONAL)
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

  -- PASOS CONFIRMADOS (hasta 9 pasos)
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

CREATE INDEX IF NOT EXISTS idx_ats_tipo    ON ats (tipo_ats);
CREATE INDEX IF NOT EXISTS idx_ats_empresa ON ats (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ats_fecha   ON ats (fecha_elaboracion);

-- DOWN
-- DROP TABLE IF EXISTS ats;
