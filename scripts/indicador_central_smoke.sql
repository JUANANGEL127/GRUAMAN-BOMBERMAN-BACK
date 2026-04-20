-- Smoke queries para validar la implementación del indicador central
-- Ejecutar manualmente en la base de datos del entorno correspondiente.

-- 1) Ver configuración activa
SELECT id, version, is_active, destinatarios, umbrales, distribucion_habilitada, scope
FROM indicador_central_config_versions
ORDER BY version DESC;

-- 2) Ver últimas ejecuciones
SELECT id, corte_tipo, corte_fecha, canal, estado, origen, snapshot_batch_id, resumen, error_message, started_at, finished_at
FROM indicador_central_ejecuciones
ORDER BY id DESC
LIMIT 20;

-- 3) Ver snapshots recientes
SELECT batch_id, corte_tipo, corte_fecha, fecha_registro, nombre_operador, actividad_registrada, cumplimiento_pct, total_registros, anomalias
FROM indicador_central_dataset_snapshot
ORDER BY id DESC
LIMIT 50;

-- 4) Verificar idempotencia (debe haber a lo sumo un success por corte/canal)
SELECT corte_tipo, corte_fecha, canal, COUNT(*) AS success_count
FROM indicador_central_ejecuciones
WHERE estado = 'success'
GROUP BY corte_tipo, corte_fecha, canal
HAVING COUNT(*) > 1;

-- 5) Verificar destinatarios como arreglo JSONB
SELECT id, jsonb_typeof(destinatarios) AS tipo_destinatarios, jsonb_array_length(destinatarios) AS cantidad
FROM indicador_central_config_versions
WHERE is_active = true;

-- 6) Ver filas con duplicados detectados
SELECT batch_id, fecha_registro, nombre_operador, total_registros, formatos_llenos, anomalias
FROM indicador_central_dataset_snapshot
WHERE anomalias @> '["duplicados_detectados"]'::jsonb
ORDER BY id DESC;
