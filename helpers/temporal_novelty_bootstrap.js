export const CANONICAL_TEMPORAL_NOVELTY_TYPES = [
  "vacaciones",
  "permiso",
  "sancion",
  "incapacidad_at",
  "incapacidad_general",
  "licencia"
];

export function buildTemporalNoveltyBootstrapStatements() {
  const canonicalTypeList = CANONICAL_TEMPORAL_NOVELTY_TYPES.map((tipo) => `'${tipo}'`).join(", ");

  return [
    `CREATE TABLE IF NOT EXISTS temporal_motives_catalog (
      id BIGSERIAL PRIMARY KEY,
      codigo VARCHAR(50) NOT NULL,
      nombre VARCHAR(150) NOT NULL,
      tipo VARCHAR(30) NOT NULL CHECK (tipo IN (${canonicalTypeList})),
      remunerada_default BOOLEAN NOT NULL DEFAULT false,
      activo BOOLEAN NOT NULL DEFAULT true,
      orden INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tipo, codigo)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_temporal_motives_catalog_activo_tipo ON temporal_motives_catalog (activo, tipo, id)`,
    `ALTER TABLE temporal_motives_catalog ADD COLUMN IF NOT EXISTS orden INT`,
    `ALTER TABLE temporal_motives_catalog ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE temporal_motives_catalog ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE temporal_motives_catalog DROP CONSTRAINT IF EXISTS temporal_motives_catalog_tipo_check`,
    `ALTER TABLE temporal_motives_catalog ADD CONSTRAINT temporal_motives_catalog_tipo_check CHECK (tipo IN (${canonicalTypeList}))`,
    `CREATE TABLE IF NOT EXISTS trabajador_estado_temporal (
      id BIGSERIAL PRIMARY KEY,
      trabajador_id INT NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
      tipo VARCHAR(30) NOT NULL CONSTRAINT trabajador_estado_temporal_tipo_check CHECK (tipo IN (${canonicalTypeList})),
      motivo TEXT NOT NULL,
      motivo_catalogo_id BIGINT REFERENCES temporal_motives_catalog(id) ON DELETE SET NULL,
      motivo_codigo_snapshot VARCHAR(50),
      motivo_nombre_snapshot VARCHAR(150),
      motivo_tipo_snapshot VARCHAR(30),
      motivo_remunerada_snapshot BOOLEAN,
      remunerada BOOLEAN NOT NULL DEFAULT false,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE,
      cerrado_at TIMESTAMPTZ,
      cerrado_by INT,
      anulado_at TIMESTAMPTZ,
      anulado_by INT,
      anulado_motivo TEXT,
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
    );`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS motivo_catalogo_id BIGINT`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS motivo_codigo_snapshot VARCHAR(50)`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS motivo_nombre_snapshot VARCHAR(150)`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS motivo_tipo_snapshot VARCHAR(30)`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS motivo_remunerada_snapshot BOOLEAN`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS cerrado_at TIMESTAMPTZ`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS cerrado_by INT`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS anulado_by INT`,
    `ALTER TABLE trabajador_estado_temporal ADD COLUMN IF NOT EXISTS anulado_motivo TEXT`,
    `ALTER TABLE trabajador_estado_temporal DROP CONSTRAINT IF EXISTS trabajador_estado_temporal_tipo_check`,
    `ALTER TABLE trabajador_estado_temporal ADD CONSTRAINT trabajador_estado_temporal_tipo_check CHECK (tipo IN (${canonicalTypeList}))`,
    `ALTER TABLE trabajador_estado_temporal ADD CONSTRAINT trabajador_estado_temporal_motivo_catalogo_fk FOREIGN KEY (motivo_catalogo_id) REFERENCES temporal_motives_catalog(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_trabajador_estado_temporal_trabajador_rango ON trabajador_estado_temporal (trabajador_id, fecha_inicio DESC, fecha_fin DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trabajador_estado_temporal_tipo_fecha ON trabajador_estado_temporal (tipo, fecha_inicio DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trabajador_estado_temporal_motivo_catalogo ON trabajador_estado_temporal (motivo_catalogo_id)`,
    `ALTER TABLE trabajador_estado_temporal DROP CONSTRAINT IF EXISTS trabajador_estado_temporal_no_overlap`
  ];
}
