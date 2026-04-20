**PRD – Automatización del Indicador de Adaptación de la app La Central**

Borrador funcional para pasar a SDD | Basado en los archivos “registros_diarios” y “Indicador de Adaptación GLOBAL” compartidos por el usuario | 08-abr-2026

**Resumen ejecutivo  
**El proceso actual depende de una descarga manual y de fórmulas en Excel que mezclan tres conceptos: ingreso, actividad y cumplimiento. La propuesta es separar esas métricas, corregir la base analítica, rediseñar la visualización para dirección y automatizar la generación y envío del indicador con cron job y consulta backend.

**1\. Contexto y problema de negocio**

Hoy el indicador de adaptación se arma manualmente a partir de un archivo de reporte diario y un workbook histórico por mes. El objetivo del negocio es contar con una lectura clara y accionable para directores o comité IT, con foco en dos preguntas: quién no tuvo actividad y qué tanto se están diligenciando los formatos esperados.

- La visualización actual no comunica con claridad excepciones, tendencias ni causas.
- La métrica “entró / no entró” hoy se aproxima con base en registros diligenciados, lo que puede confundir login con actividad útil.
- El proceso manual introduce riesgo operativo, reprocesos y baja trazabilidad.
- La automatización futura requiere primero acordar un modelo de datos y reglas de negocio estables.

**2\. Hallazgos del análisis del material entregado**

A partir de los archivos compartidos se identificaron hallazgos que deben quedar explícitos en el diseño funcional para evitar que la automatización replique errores del Excel actual:

|     |     |
| --- | --- |
| **Hallazgo** | **Impacto funcional** |
| El archivo fuente “registros_diarios” trae las columnas Fecha, Nombre Usuario, Empresa, Nombre Proyecto, Total Registros, Formatos Llenos y Formatos Faltantes. | Ya existe una estructura mínima suficiente para construir un mart analítico sin depender del workbook manual. |
| En el workbook actual hay hojas de datos crudos por mes y hojas derivadas para uso binario, uso total y promedio general. | La solución futura debe preservar esas salidas de negocio, pero no necesariamente la estructura física del Excel. |
| Existen casos donde Total Registros supera 7 aunque el universo esperado de formatos es 7. | Si se divide directamente Total Registros / 7, el indicador puede superar 100 %, lo que degrada la credibilidad del reporte. |
| En marzo se observan filas duplicadas para un mismo operario y fecha en varios días. | Sin una regla de deduplicación o consolidación, el cumplimiento diario queda inflado y el promedio mensual se distorsiona. |
| Se encontraron fechas fuera del mes nominal de algunas hojas históricas. | La partición mensual debe calcularse por la fecha real del registro, no por el nombre de la hoja o archivo. |
| La lógica actual clasifica “no ingresó” cuando no hay registros diligenciados. | Ese nombre induce a error. Lo correcto hoy es hablar de “sin actividad registrada” hasta tener logs reales de login. |

**Recomendación de gobierno del dato  
**Cambiar el lenguaje del indicador. Mientras la app no exponga eventos de autenticación confiables, la métrica operativa debe llamarse “actividad registrada en la app” y no “ingreso”. Esto evita conversaciones improductivas con operación y reduce falsos positivos.

**3\. Objetivo del producto**

Diseñar e implementar un proceso estandarizado para generar, visualizar y enviar automáticamente el indicador de adaptación de la app La Central, con definiciones de negocio trazables, una presentación ejecutiva clara y una base lista para implementación backend + cron job.

**4\. Objetivos específicos**

- Separar y formalizar las métricas de actividad, cumplimiento y promedio mensual.
- Rediseñar la visualización para que dirección vea primero excepciones, tendencia y nivel de riesgo.
- Eliminar la dependencia del cálculo manual en Excel como fuente oficial.
- Habilitar envío automático por correo con resumen ejecutivo y detalle accionable.
- Dejar definidas reglas de negocio, contratos de datos y criterios de aceptación para SDD.

**5\. Alcance**

|     |     |
| --- | --- |
| **Incluye** | **No incluye en esta fase** |
| Definición funcional de métricas, visualizaciones, flujo de datos, reglas de consolidación, correo automático y cron job. | Cambios en la app móvil para capturar eventos de login reales o telemetría más fina. |
| Diseño de dataset analítico diario y mensual por operario. | Motor de BI corporativo definitivo, salvo que el equipo decida usarlo en la fase técnica. |
| Propuesta de manejo de causas de no actividad mediante enriquecimiento manual o catálogo. | Rediseño del producto operativo de campo o de los formatos diligenciados. |
| Criterios de calidad de dato, trazabilidad y alertas. | Ajustes de nómina, turnos o asistencia fuera del indicador. |

**6\. Usuarios y necesidades**

- Directores / comité IT: requieren un correo ejecutivo de lectura rápida, con foco en excepción, tendencia y decisión.
- Líderes operativos: necesitan identificar qué personas quedaron sin actividad y dónde intervenir.
- Equipo técnico / backend: necesita reglas inequívocas para extraer, transformar, consolidar y enviar el indicador.
- Analista funcional: requiere mantener un catálogo de causas y parámetros sin reescribir código.

**7\. Flujo objetivo de extremo a extremo**

|     |     |
| --- | --- |
| **Paso** | **Salida esperada** |
| 1\. Extracción programada | Consulta backend o export automático del reporte registros_diarios para el rango del día o del mes. |
| 2\. Staging y validación | Archivo crudo almacenado con sello de tiempo, validación de columnas obligatorias y conteo de filas. |
| 3\. Normalización | Estandarización de nombres, roles, fechas y listas de formatos; cálculo de banderas de calidad. |
| 4\. Agregación analítica | Tabla diaria por operario con actividad, cumplimiento, causas y alertas. |
| 5\. Generación de salidas | Dataset para dashboard, HTML del correo y adjunto opcional Excel/PDF. |
| 6\. Distribución | Envío automático al grupo de directores o comité IT con trazabilidad del envío. |
| 7\. Monitoreo | Registro de ejecución, reintentos, alertas de fallo y auditoría de cambios manuales. |

**8\. Modelo funcional propuesto**

**8.1 Entidades mínimas**

- Operario: identificador, nombre normalizado, rol, empresa y estado.
- Fecha: fecha calendario, mes de corte, semana y día hábil/no hábil.
- Formato obligatorio: código, nombre, vigencia y aplicabilidad por rol si aplica.
- Actividad diaria: consolidado final por operario y fecha.
- Causa de no actividad: catálogo editable con responsable, comentario y fecha de actualización.

**8.2 Métricas canónicas**

|     |     |     |
| --- | --- | --- |
| **Métrica** | **Definición recomendada** | **Observación** |
| Actividad diaria | 1 cuando el operario diligenció al menos un formato obligatorio del día; 0 en caso contrario. | Usar el conteo de formatos llenos distintos; no basarse solo en login. |
| Sin actividad registrada | 1 cuando Actividad diaria = 0. | Esta es la vista clave para el comité. |
| Cumplimiento diario | min(100 %, formatos_obligatorios_distintos_diligenciados / formatos_obligatorios_esperados). | Se debe capar a 100 % para evitar inflaciones por duplicados o multi-proyecto. |
| Cumplimiento mensual por persona | Promedio simple o ponderado de cumplimiento diario sobre los días esperados del mes. | Definir si se excluyen descansos, vacaciones, incapacidades y turnos no programados. |
| Cobertura del día por rol | Operarios con actividad / operarios esperados del rol. | Permite tablero tipo “BOMBERMAN: ingresaron 25 / esperados 30”. |
| Calidad del dato | Banderas como duplicado, rol vacío, fecha fuera de corte, total_registros > universo_formularios, inconsistencia entre columnas. | No se debe ocultar; debe quedar en un anexo o alerta técnica. |

**Regla clave de consolidación  
**Para evitar sobreconteos, el cumplimiento diario debe construirse con formatos obligatorios distintos diligenciados por operario y fecha. Si existen varias filas del mismo operario en el día por proyecto o duplicación de export, primero se consolida el conjunto de formatos y luego se calcula el porcentaje.

**9\. Reglas de transformación del dato**

1.  Tomar el reporte fuente del backend para el rango del corte.
2.  Normalizar nombres de columnas y tipos de dato.
3.  Convertir Fecha a tipo fecha y asignar mes de corte por valor real.
4.  Normalizar rol o empresa a un catálogo controlado: Gruaman, bomberman, líder bomba u otros valores aprobados.
5.  Separar las listas de Formatos Llenos y Formatos Faltantes en arreglos o filas normalizadas.
6.  Consolidar por operario + fecha usando unión de formatos llenos distintos.
7.  Derivar actividad_diaria, cumplimiento_diario y banderas de calidad.
8.  Cruzar opcionalmente con una tabla de personal esperado para no penalizar ausencias justificadas.
9.  Persistir el dataset final para consumo de email, dashboard y auditoría.

**10\. Visualización requerida**

**10.1 Vista ejecutiva de actividad (sin actividad registrada)**

- Encabezado con fecha de corte, total de operarios esperados, activos y sin actividad.
- Tarjetas por rol: por ejemplo, “BOMBERMAN | con actividad 25 | esperados 30 | cobertura 83 %”.
- Matriz diaria por día del mes con una columna por fecha y una fila por operario o por rol, privilegiando resaltar en rojo los casos sin actividad.
- Bloque de excepciones con nombre, rol, causa reportada y responsable de seguimiento.
- Pie con tendencia del mes y comparación contra el día o semana anterior.

**10.2 Vista ejecutiva de cumplimiento**

- Tarjetas de resumen: promedio mensual, porcentaje de operarios en 100 %, porcentaje por debajo del umbral y top 5 críticos.
- Matriz diaria con porcentaje o conteo de formatos diligenciados por persona.
- Agrupación por rol y total del día para lectura rápida.
- Semáforo por umbral: verde >= 90 %, ámbar 70–89 %, rojo < 70 %.

**10.3 Principios de diseño visual**

- El correo debe responder en menos de 20 segundos a la pregunta “qué debo atender hoy”.
- La primera pantalla o primer bloque debe mostrar excepción antes que detalle exhaustivo.
- Los colores deben usarse para estatus y no para decoración.
- La tabla detallada solo debe incluir las columnas necesarias para actuar.

**11\. Correo automático – requerimientos funcionales**

|     |     |
| --- | --- |
| **Componente** | **Requisito** |
| Asunto | Indicador de adaptación app La Central \| corte {fecha} |
| Destinatarios | Lista de distribución de directores o comité IT parametrizable. |
| Cuerpo | Resumen ejecutivo + actividad + cumplimiento + excepciones + notas de calidad del dato. |
| Gráficos | Máximo dos visuales: tendencia diaria y distribución por rol. |
| Detalle accionable | Tabla corta de personas sin actividad y tabla corta de bajo cumplimiento. |
| Adjuntos opcionales | Excel o PDF de soporte cuando el comité lo solicite. |
| Trazabilidad | Guardar fecha de envío, destinatarios, estado y versión del dataset usado. |

**Plantilla sugerida del correo  
**1) Resumen ejecutivo.  
2) Cobertura de actividad del día.  
3) Cumplimiento diario y acumulado del mes.  
4) Personas sin actividad registrada y causa.  
5) Observaciones de calidad del dato.  
6) Enlace o adjunto de detalle.

**12\. Automatización y operación**

- Programación vía cron job o scheduler equivalente en backend.
- Ejecución ideal una vez esté cerrado el corte diario y disponible la consulta fuente.
- Proceso idempotente: si corre dos veces para el mismo corte, no debe duplicar envíos ni registros.
- Reintentos automáticos ante fallos transitorios y alerta técnica cuando falle la ejecución final.
- Parámetros editables sin despliegue: destinatarios, umbrales, universo de formatos, exclusiones y asunto del correo.

**13\. Requisitos no funcionales**

- Trazabilidad: cada indicador debe poder reconstruirse desde el archivo o consulta fuente.
- Confiabilidad: el cálculo debe ser determinístico y versionado.
- Mantenibilidad: reglas de negocio centralizadas y documentadas.
- Tiempo de proceso: objetivo < 5 minutos para el corte diario.
- Seguridad: acceso restringido a datos personales y a listas de distribución.
- Observabilidad: logging de extracción, transformaciones, conteos, excepciones y envío.

**14\. Criterios de aceptación**

|     |     |
| --- | --- |
| **ID** | **Criterio** |
| CA-01 | Dado un día de corte, el sistema genera un consolidado por operario y fecha sin depender de fórmulas manuales en Excel. |
| CA-02 | El indicador de cumplimiento diario nunca supera 100 %. |
| CA-03 | Las filas duplicadas del reporte fuente quedan identificadas y no inflan el resultado final. |
| CA-04 | La vista ejecutiva resalta claramente personas sin actividad registrada y su causa cuando exista. |
| CA-05 | El correo se envía automáticamente al grupo parametrizado y deja evidencia de ejecución. |
| CA-06 | Los umbrales y destinatarios pueden cambiarse sin tocar el código del cálculo principal. |
| CA-07 | Existe una salida de detalle para auditoría con los campos usados en el cálculo. |

**15\. Riesgos y mitigaciones**

|     |     |
| --- | --- |
| **Riesgo** | **Mitigación** |
| Confundir ausencia de actividad con ausencia laboral o con login fallido. | Cruzar con roster/turno esperado y renombrar la métrica a “sin actividad registrada”. |
| Datos duplicados o repetidos desde el backend. | Aplicar reglas de consolidación y alertas de calidad antes del cálculo final. |
| Cambios futuros en el universo de formatos obligatorios. | Mantener catálogo versionado de formatos esperados por rol o vigencia. |
| Baja adopción del correo por exceso de detalle. | Diseñar correo corto con foco en excepción y adjuntar el detalle solo como soporte. |
| Dependencia de carga manual de causas. | Permitir captura ligera en tabla auxiliar o formulario simple con responsable. |

**16\. Plan de implementación recomendado**

1.  Fase 0 – Alineación funcional: cerrar definiciones de actividad, cumplimiento, universo esperado y población objetivo.
2.  Fase 1 – Dataset confiable: construir consulta o ETL que entregue el consolidado diario por operario + fecha + rol.
3.  Fase 2 – Visualización: validar diseño del correo y de la tabla detallada con un corte real de uno o dos días.
4.  Fase 3 – Automatización: programar cron, envío, logging, reintentos y parametrización.
5.  Fase 4 – Endurecimiento: incorporar causas, roster esperado y tablero histórico si el negocio lo requiere.

**17\. Preguntas abiertas para cerrar antes del SDD**

|     |     |
| --- | --- |
| **Tema** | **Pregunta que debe resolverse** |
| Población objetivo | ¿El indicador debe medir a todos los operarios del reporte o solo a quienes estaban programados para trabajar ese día? |
| Roster / turnos | ¿Existe una fuente confiable de personal esperado por día, vacaciones, incapacidades y descansos? |
| Universo de formatos | ¿Los 7 formatos obligatorios aplican a todos los roles o hay diferencias por rol/proyecto? |
| Granularidad | Si una persona trabaja en varios proyectos el mismo día, ¿el cumplimiento se mide por formato distinto o por total de diligenciamientos? |
| Causas | ¿Quién diligencia y mantiene la causa de no actividad? ¿Debe quedar en backend, Excel auxiliar o formulario? |
| Momento de envío | ¿A qué hora queda oficialmente cerrado el dato del día para enviar el correo sin reproceso? |
| Canal de salida | ¿Solo correo o también tablero web / Power BI / Excel adjunto? |
| Aprobación | ¿Quién es dueño funcional del indicador y de cambios futuros en la definición? |

**Decisión recomendada para arrancar rápido  
**Construir la primera versión con dos salidas oficiales: 1) correo ejecutivo diario y 2) dataset auditable por operario y fecha. Dejar el Excel como respaldo temporal, pero no como motor de cálculo.