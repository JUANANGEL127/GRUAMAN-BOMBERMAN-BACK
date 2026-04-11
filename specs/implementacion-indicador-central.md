# Implementación backend — Indicador Central

Documento de estado real del backend del cambio `automatizacion-indicador-central`.

## 1. Qué quedó implementado

- Extracción del cálculo compartido a `helpers/indicador_central.js`.
- Generación de XLSX reutilizable en `helpers/indicador_central_excel.js`.
- Reuso del helper desde `routes/administrador/registros_diarios.js` para `/buscar` y `/descargar`.
- Nuevo router `routes/administrador/indicador_central.js` con:
  - `GET /administrador/indicador_central/configuracion`
  - `PUT /administrador/indicador_central/configuracion`
  - `POST /administrador/indicador_central/ejecutar`
- Bootstrap en `index.js` de:
  - `indicador_central_config_versions`
  - `indicador_central_ejecuciones`
  - `indicador_central_dataset_snapshot`
- Cron diario `0 0 * * *` en `America/Bogota` para procesar el día D en `D+1 00:00`.
- Idempotencia por índice único parcial sobre `(corte_tipo, corte_fecha, canal)` cuando `estado = 'success'`.
- Persistencia de destinatarios como arreglo JSONB.
- Backfill idempotente de columnas faltantes en `trabajadores` y `obras` para reducir drift de esquema.

## 2. Semántica real del backend

### 2.1 Ingreso vs cumplimiento

El backend separa dos conceptos que antes quedaban mezclados:

- **Ingreso / actividad registrada** = haber diligenciado `horas_jornada`.
- **Cumplimiento** = completar los formatos operativos esperados, excluyendo `horas_jornada`.

Reglas actuales:

```txt
actividad_registrada = formatos_llenos.includes('horas_jornada')
formatos_operativos_esperados = formatos_esperados - ['horas_jornada']
cumplimiento_pct = formatos_operativos_llenos / formatos_operativos_esperados * 100
```

Consecuencia de negocio:

- Si un operario cargó `horas_jornada`, se considera con ingreso.
- Si no cargó `horas_jornada`, se considera sin ingreso aunque tenga otros formatos cargados.
- `cumplimiento_pct` no se infla con `horas_jornada`; esa validación queda reservada al ingreso.

### 2.2 Caso borde operativo

Si una empresa futura llega a tener únicamente `horas_jornada` y ningún formato operativo adicional:

- `actividad_registrada` sigue funcionando.
- `cumplimiento_pct` queda en `0`.
- Se marca la anomalía `sin_formatos_operativos_configurados`.

Esta decisión evita mostrar 100% de cumplimiento cuando en realidad no hay formatos operativos que medir.

### 2.3 Scope real: enfoque empresa-first

El universo esperado se resuelve con enfoque **empresa-first**.

Regla actual:

- `scope.empresa_ids` es el filtro principal recomendado.
- `scope.obra_id` y `scope.obra_nombre` siguen existiendo como referencia o segmentación opcional.
- Si `scope.empresa_ids` tiene valores y `scope.segmentar_por_obra !== true`, el helper filtra por empresa y no excluye trabajadores sin obra asignada.
- Si no hay `empresa_ids` pero sí `obra_id` o `obra_nombre`, el helper intenta derivar `empresa_ids` desde `obras.empresa_id` para mantener compatibilidad con configuraciones viejas.

### 2.4 Default real del scope

El default vigente del indicador central es:

```json
{
  "scope": {
    "empresa_ids": [1, 2],
    "obra_id": null,
    "obra_nombre": null,
    "segmentar_por_obra": false,
    "nombres": []
  }
}
```

Eso deja fuera por default a `empresa_id = 5` (`Lideres`).

### 2.5 Cómo excluir empresas distintas de 1 y 2

La forma correcta de excluir otras empresas es actualizar la configuración activa con `PUT /administrador/indicador_central/configuracion` y mandar un `scope.empresa_ids` explícito.

Ejemplo seguro para mantener solo `1` y `2` sin arrastrar filtros viejos de obra:

```http
PUT /administrador/indicador_central/configuracion
Content-Type: application/json

{
  "scope": {
    "empresa_ids": [1, 2],
    "obra_id": null,
    "obra_nombre": null,
    "segmentar_por_obra": false,
    "nombres": []
  }
}
```

Importante:

- El endpoint hace merge con la configuración activa.
- El merge es anidado para `umbrales` y `scope`.
- Si solo querés cambiar el scope, no hace falta reenviar todo el documento.
- Pero si venís de una config vieja con `obra_id`, `obra_nombre` o `segmentar_por_obra = true`, conviene resetear esos campos explícitamente para que el universo quede realmente empresa-first.
- Si una configuración previa tenía más empresas, al poner `[1, 2]` las excluís explícitamente del universo esperado.

Si más adelante querés incluir `5` u otra empresa, tenés que declararlo de forma consciente en `scope.empresa_ids`.

## 3. Resumen diario vs mensual

### 3.1 Diario

El resumen diario sigue siendo granularidad **persona-día**.

- `operarios_con_actividad` = días con `horas_jornada`
- `operarios_sin_actividad` = días sin `horas_jornada`

### 3.2 Mensual

El resumen mensual existe y devuelve:

- `granularidad_resumen = persona_unica_mensual`
- `total_operarios` = personas únicas evaluadas en el mes
- `operarios_con_actividad` = personas con al menos un día con `horas_jornada`
- `operarios_sin_actividad` = personas sin `horas_jornada` en todo el mes
- `duplicados_detectados` = personas con al menos un día con duplicados
- `metricas_persona_dia` = resumen complementario en granularidad persona-día

Ese `metricas_persona_dia` conserva el detalle auditado mensual sin perder trazabilidad diaria.

## 4. Workbook / informe XLSX actual

El workbook actual ya separa ingreso y cumplimiento y ahora expone cuatro pestañas coherentes entre sí:

- `Resumen`
- `Detalle`
- `Ausencias - No ingreso`
- `Desempeño por persona`

### Resumen

- “Ingreso validado por” = `horas_jornada`
- “Cumplimiento validado sobre” = formatos operativos, excluyendo `horas_jornada`
- En mensual:
  - “Operarios únicos evaluados”
  - “Operarios únicos con ingreso”
  - “Operarios únicos sin ingreso”
  - “Detalle auditado (persona-día)”
  - “Días con ingreso”
  - “Días sin ingreso”

### Detalle

El detalle expone:

- `Ingreso Registrado (horas_jornada)`
- `Cumplimiento % (sin horas_jornada)`
- `Formatos Llenos`
- `Formatos Operativos Llenos`
- `Formatos Operativos Faltantes`
- `Formatos Faltantes Totales`

### Ausencias - No ingreso

Lista todos los persona-día del período consultado donde **no** hubo `horas_jornada`.

Semántica implementada:

- una fila por `persona + fecha`;
- se consideran ausencias / no ingreso aunque existan otros formatos operativos cargados;
- incluye `fecha`, `nombre`, `empresa`, `proyecto/obra`, `total_registros`, `formatos_llenos`, `formatos_operativos_llenos`, `formatos_operativos_faltantes` y `anomalias`.

### Desempeño por persona

Consolida el período consultado por persona, tanto para diario como para mensual.

Semántica implementada:

- clave de consolidación: `empresa + nombre`;
- `días_evaluados` = cantidad de filas persona-día del período;
- `días_con_ingreso` = días con `horas_jornada`;
- `días_sin_ingreso` = días sin `horas_jornada`;
- `ingreso_pct_periodo = días_con_ingreso / días_evaluados * 100`;
- `formatos_operativos_esperados_total` = suma del universo operativo esperado por día;
- `formatos_operativos_llenos_total` = suma de formatos operativos distintos diligenciados por día;
- `cumplimiento_pct_periodo = formatos_operativos_llenos_total / formatos_operativos_esperados_total * 100`, capado a 100;
- `días_con_duplicados` = cantidad de persona-día con anomalía `duplicados_detectados`.

Además, la pestaña agrega campos operativos útiles como `días_con_registros`, `total_registros_periodo`, `promedio_cumplimiento_pct_persona_dia`, `proyectos_obras` y `anomalias`.

## 5. Endpoint backend

### `GET /administrador/indicador_central/configuracion`

Retorna la configuración activa.

### `PUT /administrador/indicador_central/configuracion`

Crea una nueva versión activa.

Comportamiento real del handler:

- toma la configuración activa actual;
- hace merge top-level con el body recibido;
- hace merge anidado de `umbrales`;
- hace merge anidado de `scope`;
- persiste una nueva versión activa.

### `POST /administrador/indicador_central/ejecutar`

Body sugerido:

```json
{
  "fecha_corte": "2026-04-06",
  "corte_tipo": "diario",
  "omitir_envio": true
}
```

## 6. Defaults de configuración

`getIndicadorCentralDefaultConfig()` deja este shape base:

```json
{
  "destinatarios": [],
  "umbrales": {
    "alerta_pct": 70,
    "objetivo_pct": 90
  },
  "formatos_por_empresa": {
    "1": [
      "chequeo_alturas",
      "chequeo_elevador",
      "inspeccion_epcc",
      "inspeccion_izaje",
      "permiso_trabajo",
      "chequeo_torregruas",
      "horas_jornada"
    ],
    "2": [
      "inspeccion_epcc",
      "permiso_trabajo",
      "horas_jornada",
      "checklist",
      "inventario_obra",
      "planilla_bombeo",
      "chequeo_alturas"
    ]
  },
  "exclusiones": [],
  "distribucion_habilitada": false,
  "scope": {
    "empresa_ids": [1, 2],
    "obra_id": null,
    "obra_nombre": null,
    "segmentar_por_obra": false,
    "nombres": []
  }
}
```

## 7. Estado actual del workbook enriquecido

El helper de Excel quedó alineado con el dataset derivado del backend y ya no depende de lógica ad-hoc escondida en la exportación.

### 7.1 Derivación reutilizable

- `helpers/indicador_central.js` deriva `workbook_datasets` a partir de `rows`;
- el Excel reutiliza ese bloque tanto para el corte automático como para `/administrador/registros_diarios/descargar`;
- el contrato existente de resumen diario/mensual no cambia; se agregan datasets específicos para reporting.

### 7.2 Tabs implementadas

- `Resumen`: métricas del corte, período consultado y conteos de tabs derivadas.
- `Detalle`: base persona-día auditable.
- `Ausencias - No ingreso`: todos los persona-día sin `horas_jornada`.
- `Desempeño por persona`: consolidado por persona para el período seleccionado.

### 7.3 Riesgos y decisiones abiertas

- Definir si `cumplimiento_pct = 0` para empresas sin formatos operativos sigue siendo la semántica final.
- Aclarar cómo se consolida el resumen cuando un operario cambia de empresa u obra dentro del mismo período.
- La semántica actual del tab de ausencias lista días aislados sin ingreso en cortes mensuales; si negocio quiere “ausencia total mensual” habrá que agregar otro consolidado.
- Revisar si la segmentación estricta por obra debe seguir siendo opcional o convertirse en una regla separada del scope por empresa.

## 8. Variables de entorno involucradas

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `INDICADOR_CENTRAL_DESTINATARIOS` (opcional, semilla inicial)

## 9. Checklist de validación manual

### 9.1 Confirmar configuración activa

```sql
SELECT id, version, is_active, scope, formatos_por_empresa
FROM indicador_central_config_versions
WHERE is_active = true
ORDER BY version DESC
LIMIT 1;
```

### 9.2 Confirmar que líderes no entren por default

```sql
SELECT COUNT(*) AS lideres_activos
FROM trabajadores
WHERE COALESCE(activo, true) = true
  AND empresa_id = 5;
```

```sql
SELECT COUNT(*) AS universo_default_gruaman_bomberman
FROM trabajadores
WHERE COALESCE(activo, true) = true
  AND empresa_id = ANY(ARRAY[1,2]);
```

### 9.3 Ejecutar corte manual

```http
POST /administrador/indicador_central/ejecutar
Content-Type: application/json

{
  "fecha_corte": "2026-02-28",
  "corte_tipo": "mensual",
  "omitir_envio": true
}
```

### 9.4 Validar resumen persistido

```sql
SELECT corte_tipo,
       corte_fecha,
       resumen->>'granularidad_resumen' AS granularidad,
       resumen->>'total_operarios' AS total_operarios,
       resumen->>'operarios_con_actividad' AS con_ingreso,
       resumen->>'operarios_sin_actividad' AS sin_ingreso,
       resumen->>'promedio_cumplimiento_pct' AS cumplimiento,
       resumen->>'duplicados_detectados' AS duplicados_persona
FROM indicador_central_ejecuciones
ORDER BY id DESC
LIMIT 5;
```

### 9.5 Validar que la actividad dependa de `horas_jornada`

Tomá una fila del snapshot donde un operario tenga otros formatos pero no `horas_jornada` y confirmá:

- `actividad_registrada = false`
- `cumplimiento_pct` puede ser mayor que `0` si diligenció formatos operativos

```sql
SELECT fecha_registro,
       nombre_operador,
       actividad_registrada,
       cumplimiento_pct,
       formatos_llenos,
       raw->'formatos_operativos_llenos' AS formatos_operativos_llenos
FROM indicador_central_dataset_snapshot
WHERE corte_tipo = 'mensual'
ORDER BY id DESC
LIMIT 20;
```

## 10. Limitaciones actuales

- No se ejecutaron builds por instrucción explícita del flujo.
- El corte mensual sigue requiriendo validación funcional contra históricos si se quieren comparar ejecuciones previas con la semántica nueva.
- No se implementó UI de parametrización; la API quedó lista para que el frontend la consuma.
