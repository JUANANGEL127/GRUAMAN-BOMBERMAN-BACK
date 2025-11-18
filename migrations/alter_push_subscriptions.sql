-- 1. Elimina la restricción PRIMARY KEY de trabajador_id
ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_pkey;

-- 2. Agrega una columna id SERIAL como PRIMARY KEY (solo si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='push_subscriptions' AND column_name='id'
  ) THEN
    ALTER TABLE push_subscriptions ADD COLUMN id SERIAL PRIMARY KEY;
  END IF;
END$$;

-- 3. (Opcional) Si quieres evitar duplicados exactos, puedes agregar un índice único en (trabajador_id, subscription)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_trabajador_subscription ON push_subscriptions(trabajador_id, subscription);

-- 4. Agrega un campo de fecha de suscripción (solo si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='push_subscriptions' AND column_name='fecha_suscripcion'
  ) THEN
    ALTER TABLE push_subscriptions ADD COLUMN fecha_suscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END$$;
