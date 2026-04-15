# PRD — Ajustes Indicador Central: correo con gráfica segmentada y envío mensual acumulado

## 1. Objetivo

Ajustar la automatización del Indicador Central para que el correo ejecutivo refleje mejor el seguimiento operativo esperado por negocio:

- incluir la gráfica visual también en el cuerpo del correo,
- separar el comparativo por empresa principal (`1 = Grúa Man`, `2 = Bomberman`),
- y soportar un envío **mensual acumulado diario** desde el primer día del mes hasta la fecha de corte.

## 2. Contexto y problema actual

Hoy el backend ya puede:

- calcular el dataset consolidado del Indicador Central,
- generar workbook XLSX con hojas ejecutivas,
- incluir la hoja visual `Comparativo ingreso`,
- ejecutar envíos manuales y automáticos del corte diario.

Pero el aprobador funcional pidió ajustes concretos:

1. La gráfica implementada hoy solo aparece en el XLSX, no en el cuerpo del correo.
2. La gráfica actual consolida todo el universo filtrado; no separa visualmente **Grúa Man** vs **Bomberman**.
3. En el export manual por rango (`/administrador/registros_diarios/descargar`) el resumen y la gráfica actual usan semántica **persona-día**, por eso pueden aparecer métricas como:
   - `Operarios evaluados = 4170`
   - `Personas consolidadas en desempeño = 138`

   Eso hoy es técnicamente consistente con el código, pero funcionalmente confuso para negocio si no se explicita la granularidad.
4. El envío manual que se probó fue:

```json
{
  "fecha_corte": "2026-01-30",
  "corte_tipo": "diario",
  "omitir_envio": false
}
```

Eso, por contrato actual, envía únicamente el **30 de enero de 2026**, no el acumulado del mes.  
El aprobador espera un seguimiento mensual acumulado.

## 3. Validación del estado actual

### 3.1 Lo que hoy sí hace el sistema

- `corte_tipo = "diario"` procesa solo una fecha.
- `corte_tipo = "mensual"` hoy procesa **mes completo** de la fecha enviada, usando:
  - inicio de mes,
  - fin de mes,
  - y `fechaCorte = fin de mes`.
- La configuración por `scope.empresa_ids = [1, 2]` **sí excluye** empresas distintas de 1 y 2, pero **no segmenta** el resultado por empresa; simplemente limita el universo.
- En `POST /administrador/registros_diarios/descargar`, aunque el rango cubra varios días, el helper hoy usa `corteTipo = 'diario'`, por lo que el resumen/visual principal sale en granularidad **persona-día**.
- El cuerpo del correo actual muestra solo HTML con métricas textuales y adjunta el XLSX.

### 3.2 Conclusión

La expectativa del aprobador es válida, pero **no coincide** con la semántica actual:

- el daily actual no da acumulado mensual;
- el scope actual excluye empresas, pero no crea comparativos separados por empresa;
- el export manual por rango puede verse confuso porque mezcla una visual/resumen en persona-día con una métrica de personas consolidadas;
- la gráfica actual vive en el workbook, no en el correo.

## 4. Objetivo funcional detallado

Se necesita un nuevo comportamiento ejecutivo para el canal correo:

1. El correo debe incluir la gráfica visual dentro del cuerpo.
2. El correo debe mostrar **tres comparativos**:
   - uno total del universo evaluado dentro del scope,
   - uno para **Grúa Man** (`empresa_id = 1`),
   - uno para **Bomberman** (`empresa_id = 2`).
3. La hoja visual del XLSX debe seguir la misma lógica de tres comparativos:
   - total,
   - Grúa Man,
   - Bomberman.
4. El envío programado principal debe funcionar como **mensual acumulado diario**:
   - todos los días a las 00:00,
   - tomando desde el día 1 del mes actual hasta el día inmediatamente anterior a la ejecución.

### Ejemplo esperado

Si hoy es **13 de abril de 2026** y el cron corre a las **00:00 de America/Bogota**:

- se debe enviar el acumulado **del 1 al 12 de abril de 2026**.

Si mañana vuelve a correr:

- se debe enviar el acumulado **del 1 al 13 de abril de 2026**.

## 5. Requisitos funcionales

### RF-01 — Gráfica en el cuerpo del correo

El correo del Indicador Central debe incluir una representación visual del comparativo de ingreso en el HTML del mensaje, no solo dentro del XLSX.

### RF-02 — Comparativo total + separación visual por empresa

El correo y la hoja visual del XLSX deben mostrar:

- un comparativo global del universo dentro del scope activo,
- un comparativo de Grúa Man (`empresa_id = 1`),
- un comparativo de Bomberman (`empresa_id = 2`).

No deben aparecer empresas fuera de ese universo salvo que una futura configuración lo habilite explícitamente.

### RF-03 — Segmentación basada en el dataset real

La segmentación por empresa debe salir del dataset consolidado del indicador, no de una lectura superficial del `scope`.

Es decir:

- el `scope` limita el universo,
- pero la visual debe agrupar explícitamente por `empresa_id`.

### RF-04 — Nuevo modo de corte mensual acumulado

El sistema debe soportar un modo de corte acumulado del mes actual hasta la fecha de corte.

Regla:

- `fecha_desde = primer día del mes`
- `fecha_hasta = fecha de corte efectiva`

Para el cron de las 00:00, la fecha efectiva debe ser el día inmediatamente anterior a la ejecución.

### RF-05 — Cron diario para acumulado mensual

El cron automático debe poder ejecutar diariamente ese acumulado mensual.

Ejemplo:

- a las 00:00 del 13 de abril de 2026 se envía del 1 al 12 de abril de 2026;
- a las 00:00 del 14 de abril de 2026 se envía del 1 al 13 de abril de 2026.

### RF-06 — Idempotencia compatible con acumulado diario

El mecanismo de idempotencia no debe bloquear el envío de acumulados diarios del mismo mes si cambió la fecha de corte.

Ejemplo:

- `2026-04-12` y `2026-04-13` deben ser ejecuciones distintas y válidas,
- aunque pertenezcan al mismo mes.

### RF-07 — Compatibilidad con lo existente

No se debe romper:

- el corte diario actual,
- el workbook XLSX actual,
- la distribución configurada por destinatarios,
- la configuración `scope`,
- la persistencia de ejecuciones y snapshots.

### RF-08 — Respeto estricto del scope

Ninguna visual, resumen o comparativo debe evaluar registros fuera del `scope` activo.

Si el `scope` actual es:

```json
{
  "empresa_ids": [1, 2],
  "obra_id": null,
  "obra_nombre": null,
  "nombres": [],
  "segmentar_por_obra": false
}
```

entonces:

- el total debe construirse solo con empresas 1 y 2,
- las gráficas por empresa deben salir solo para 1 y 2,
- y empresas fuera del scope no deben aparecer ni en el correo ni en el comparativo del XLSX.

### RF-09 — Claridad semántica de las métricas

El sistema debe evitar rotular como “Operarios evaluados” una métrica que en realidad representa **persona-día** cuando el corte o el export cubre un rango múltiple con semántica diaria.

Debe resolverse de una de estas maneras:

- o bien cambiar labels para explicitar `personas-día evaluadas`,
- o bien cambiar la base del comparativo/resumen del modo acumulado para que refleje personas únicas,
- pero no dejar mezcladas ambas lecturas sin aclaración.

## 6. Requisitos no funcionales

### RNF-01 — Mantener semántica clara

Debe distinguirse claramente:

- daily puntual,
- mensual completo,
- mensual acumulado.

No deben compartir nombre si significan cosas distintas.

### RNF-04 — Coherencia entre correo, hoja visual y resumen

El comparativo mostrado en:

- cuerpo del correo,
- hoja visual del XLSX,
- métricas resumen asociadas

debe usar la misma granularidad y la misma interpretación de negocio para evitar contradicciones como:

- gráfico persona-día,
- resumen de personas únicas,
- o viceversa,

sin aclaración explícita.

### RNF-02 — Compatibilidad con clientes de correo

La gráfica embebida en el correo debe implementarse con una estrategia robusta para clientes de correo comunes.

### RNF-03 — No duplicar cálculo

La agregación por empresa y la visual del correo deben reutilizar el dataset consolidado existente.

## 7. Alcance

### In scope

- imagen/gráfica en HTML del correo,
- comparativo total + separación Grúa Man / Bomberman en correo y hoja visual,
- nuevo modo de corte mensual acumulado,
- ajuste del cron automático para ese modo,
- revisión de idempotencia para este flujo,
- revisión de labels/resumen para evitar confusión entre persona-día y persona única,
- documentación técnica/funcional asociada.

### Out of scope

- rediseño del frontend completo,
- parametrización visual del cron desde frontend,
- dashboards externos,
- soporte multiempresa arbitrario para más compañías en esta fase.

## 8. Propuesta conceptual de solución

### 8.1 Correo

El mail debe incluir:

1. bloque ejecutivo general,
2. gráfica total,
3. gráfica Grúa Man,
4. gráfica Bomberman,
5. resumen textual por bloque,
6. adjunto XLSX como respaldo auditivo/operativo.

### 8.2 Nuevo corte

Se recomienda crear una modalidad explícita, por ejemplo:

- `mensual_acumulado`

en vez de reutilizar `mensual` con semántica ambigua.

### 8.3 Idempotencia

La idempotencia puede seguir funcionando si la clave distingue por:

- tipo de corte,
- fecha de corte,
- canal.

Con eso, cada día del mes acumulado sería un corte distinto y válido.

## 9. Riesgos y open questions

### Riesgos

1. Si se reutiliza `mensual` para acumulado y no se diferencia de “mes completo”, se genera confusión funcional.
2. La inserción de imágenes en correos puede variar entre clientes si no se elige bien la estrategia.
3. Si la agregación por empresa se hace sobre el resumen ya consolidado y no sobre dataset correcto, la segmentación puede mentir.
4. Si no se corrige la semántica del resumen del export por rango, negocio puede seguir interpretando persona-día como personas únicas.

### Open questions

1. ¿El cron diario existente debe pasar de `diario` a `mensual_acumulado`, o convivir ambos?
2. ¿Las métricas del comparativo acumulado deben expresarse en persona única o persona-día, o ambas con labels explícitos?
3. ¿El XLSX también debe separar visuales por empresa, o por ahora el pedido aplica solo al correo?

## 10. Criterios de aceptación

- CA-01: El cuerpo del correo incluye al menos una gráfica visible sin depender del XLSX.
- CA-02: El cuerpo del correo muestra tres comparativos: total, Grúa Man y Bomberman.
- CA-03: Empresas fuera de 1 y 2 no aparecen en esos comparativos por default cuando el scope activo sea `[1,2]`.
- CA-04: Existe un modo de corte acumulado mensual desde el primer día del mes hasta la fecha de corte efectiva.
- CA-05: El cron diario puede ejecutar ese acumulado mensual sin bloquearse por idempotencia entre días distintos.
- CA-06: La hoja visual del XLSX replica la misma lógica total + Grúa Man + Bomberman.
- CA-07: No se rompe el flujo existente de workbook, snapshot, configuración y envío.
- CA-08: La solución evita o aclara explícitamente la confusión entre persona-día y personas únicas en los acumulados por rango.

## 11. Entregables esperados en el nuevo flujo SDD

- proposal del cambio
- spec del nuevo modo de corte y del correo enriquecido
- design técnico del pipeline:
  - dataset por empresa,
  - imágenes en correo,
  - cron acumulado,
  - idempotencia
- tasks
- apply
- verify

## 12. Prompt sugerido para iniciar el nuevo chat

```text
Quiero iniciar un nuevo flujo SDD para el backend `GRUAMAN-BOMBERMAN-BACK`.

Tomá como PRD base el archivo:
`specs/prd-ajustes-indicador-central-correo-mensual.md`

Necesito que uses Gentle AI + Engram y arranques con `/sdd-new ajustes-indicador-central-correo-mensual` en modo interactive.

Contexto importante ya validado:
- hoy el cuerpo del correo del Indicador Central NO incluye la gráfica; solo el XLSX adjunto.
- hoy la gráfica visual NO está segmentada por empresa; el scope `[1,2]` solo limita el universo, no separa Bomberman vs Grúa Man.
- hoy el export manual por rango usa semántica `persona_dia`, por eso puede mostrar algo como `4170 operarios evaluados` y al mismo tiempo `138 personas consolidadas en desempeño`; eso hoy es técnicamente consistente pero funcionalmente confuso.
- hoy `corte_tipo = diario` procesa solo una fecha.
- hoy `corte_tipo = mensual` representa mes completo, no acumulado al día actual.
- negocio ahora pide:
  1. incluir la gráfica en el cuerpo del correo,
  2. mostrar tres gráficas/comparativos: total, Bomberman y Grúa Man,
  3. implementar envío automático mensual acumulado diario: del día 1 del mes hasta el día actual de corte,
  4. revisar idempotencia para que no bloquee envíos de días distintos dentro del mismo mes,
  5. revisar la semántica/rotulación del acumulado para no confundir persona-día con personas únicas.

Quiero que primero leas el PRD, verifiques el código real antes de afirmar nada y comiences con la fase Propose.
Guardá las decisiones de arquitectura en Engram.
No ejecutes builds.
Si encontrás que alguna expectativa del PRD no coincide con el código actual, decímelo con evidencia concreta.
```
