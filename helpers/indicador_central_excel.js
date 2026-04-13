import ExcelJS from 'exceljs';
import { renderComparativoIngresoChart } from './indicador_central_excel_chart.js';

const AUSENCIAS_SHEET_NAME = 'Ausencias - No ingreso';
const COMPARATIVO_INGRESO_SHEET_NAME = 'Comparativo ingreso';

function roundPercentage(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function applyHeaderStyle(worksheet) {
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  };
}

function toCommaList(value) {
  return Array.isArray(value) ? value.join(', ') : '';
}

function toYesNo(value) {
  return value ? 'Sí' : 'No';
}

function buildFallbackWorkerKey(row) {
  return `${String(row.empresa || '').trim().toLowerCase()}::${String(row.nombre || '').trim().toLowerCase()}`;
}

function buildFallbackWorkbookDatasets(rows = []) {
  const byWorker = new Map();

  for (const row of rows) {
    const key = buildFallbackWorkerKey(row);
    const current = byWorker.get(key) || {
      empresa: row.empresa || '',
      nombre: row.nombre,
      dias_evaluados: 0,
      dias_con_ingreso: 0,
      dias_sin_ingreso: 0,
      dias_con_duplicados: 0,
      dias_con_registros: 0,
      formatos_operativos_esperados_total: 0,
      formatos_operativos_llenos_total: 0,
      total_registros_periodo: 0,
      cumplimiento_pct_persona_dia_sum: 0,
      proyectos_obras: new Set(),
      anomalias: new Set()
    };

    current.dias_evaluados += 1;
    current.total_registros_periodo += Number(row.total_registros ?? 0);
    current.formatos_operativos_esperados_total += Array.isArray(row.formatos_operativos_llenos) || Array.isArray(row.formatos_operativos_faltantes)
      ? (row.formatos_operativos_llenos?.length ?? 0) + (row.formatos_operativos_faltantes?.length ?? 0)
      : 0;
    current.formatos_operativos_llenos_total += row.formatos_operativos_llenos?.length ?? 0;
    current.cumplimiento_pct_persona_dia_sum += Number(row.cumplimiento_pct ?? 0);

    if (row.actividad_registrada) {
      current.dias_con_ingreso += 1;
    } else {
      current.dias_sin_ingreso += 1;
    }

    if (Number(row.total_registros ?? 0) > 0) {
      current.dias_con_registros += 1;
    }

    if ((row.anomalias || []).includes('duplicados_detectados')) {
      current.dias_con_duplicados += 1;
    }

    for (const proyecto of [row.nombre_proyecto, row.obra_nombre]) {
      if (proyecto) current.proyectos_obras.add(String(proyecto).trim());
    }

    for (const anomalia of (row.anomalias || [])) {
      current.anomalias.add(anomalia);
    }

    byWorker.set(key, current);
  }

  const desempenoPorPersona = [...byWorker.values()]
    .map((row) => ({
      empresa: row.empresa,
      nombre: row.nombre,
      dias_evaluados: row.dias_evaluados,
      dias_con_ingreso: row.dias_con_ingreso,
      dias_sin_ingreso: row.dias_sin_ingreso,
      ingreso_pct_periodo: row.dias_evaluados ? roundPercentage((row.dias_con_ingreso / row.dias_evaluados) * 100) : 0,
      formatos_operativos_esperados_total: row.formatos_operativos_esperados_total,
      formatos_operativos_llenos_total: row.formatos_operativos_llenos_total,
      cumplimiento_pct_periodo: row.formatos_operativos_esperados_total
        ? roundPercentage(Math.min(100, (row.formatos_operativos_llenos_total / row.formatos_operativos_esperados_total) * 100))
        : 0,
      dias_con_duplicados: row.dias_con_duplicados,
      dias_con_registros: row.dias_con_registros,
      total_registros_periodo: row.total_registros_periodo,
      promedio_cumplimiento_pct_persona_dia: row.dias_evaluados
        ? roundPercentage(row.cumplimiento_pct_persona_dia_sum / row.dias_evaluados)
        : 0,
      proyectos_obras: [...row.proyectos_obras],
      anomalias: [...row.anomalias]
    }))
    .sort((a, b) => (
      String(a.empresa).localeCompare(String(b.empresa), 'es')
      || String(a.nombre).localeCompare(String(b.nombre), 'es')
    ));

  return {
    detalle: rows,
    ausencias_no_ingreso: rows.filter((row) => !row.actividad_registrada),
    desempeno_por_persona: desempenoPorPersona
  };
}

function buildFallbackResumen(rows = [], corteTipo = 'diario') {
  if (corteTipo === 'mensual') {
    const byWorker = new Map();

    for (const row of rows) {
      const key = buildFallbackWorkerKey(row);
      const current = byWorker.get(key) || {
        tuvoActividad: false,
        tuvoDuplicados: false,
        diasActivosCumplimiento: []
      };

      if (row.actividad_registrada) {
        current.tuvoActividad = true;
        current.diasActivosCumplimiento.push(Number(row.cumplimiento_pct || 0));
      }

      if ((row.anomalias || []).includes('duplicados_detectados')) {
        current.tuvoDuplicados = true;
      }

      byWorker.set(key, current);
    }

    const operarios = [...byWorker.values()];
    const promediosPorPersona = operarios
      .map((worker) => (
        worker.diasActivosCumplimiento.length
          ? roundPercentage(worker.diasActivosCumplimiento.reduce((acc, value) => acc + value, 0) / worker.diasActivosCumplimiento.length)
          : null
      ))
      .filter((value) => value !== null);

    return {
      total_operarios: operarios.length,
      operarios_con_actividad: operarios.filter((worker) => worker.tuvoActividad).length,
      operarios_sin_actividad: operarios.filter((worker) => !worker.tuvoActividad).length,
      promedio_cumplimiento_pct: promediosPorPersona.length
        ? roundPercentage(promediosPorPersona.reduce((acc, value) => acc + value, 0) / promediosPorPersona.length)
        : 0,
      duplicados_detectados: operarios.filter((worker) => worker.tuvoDuplicados).length,
      granularidad_resumen: 'persona_unica_mensual',
      metricas_persona_dia: buildFallbackResumen(rows, 'diario')
    };
  }

  const totalOperarios = rows.length;
  const operariosConActividad = rows.filter((row) => row.actividad_registrada).length;
  const duplicados = rows.filter((row) => (row.anomalias || []).includes('duplicados_detectados')).length;

  return {
    total_operarios: totalOperarios,
    operarios_con_actividad: operariosConActividad,
    operarios_sin_actividad: totalOperarios - operariosConActividad,
    promedio_cumplimiento_pct: totalOperarios
      ? roundPercentage(rows.reduce((acc, row) => acc + Number(row.cumplimiento_pct || 0), 0) / totalOperarios)
      : 0,
    duplicados_detectados: duplicados,
    granularidad_resumen: 'persona_dia'
  };
}

function buildResumenRows({
  resumen,
  corteTipo,
  fechaCorte,
  fechaDesde,
  fechaHasta,
  configuracion,
  workbookDatasets
}) {
  const labels = corteTipo === 'mensual'
    ? {
      total: 'Operarios únicos evaluados',
      conActividad: 'Operarios únicos con ingreso',
      sinActividad: 'Operarios únicos sin ingreso',
      duplicados: 'Operarios únicos con duplicados'
    }
    : {
      total: 'Operarios evaluados',
      conActividad: 'Con ingreso',
      sinActividad: 'Sin ingreso',
      duplicados: 'Duplicados detectados'
    };

  const periodoConsultado = fechaDesde && fechaHasta
    ? fechaDesde === fechaHasta
      ? fechaDesde
      : `${fechaDesde} a ${fechaHasta}`
    : fechaCorte;

  const resumenRows = [
    { metrica: 'Corte', valor: fechaCorte },
    { metrica: 'Período consultado', valor: periodoConsultado || fechaCorte },
    { metrica: 'Tipo de corte', valor: corteTipo },
    { metrica: 'Granularidad resumen', valor: resumen.granularidad_resumen ?? 'persona_dia' },
    { metrica: 'Ingreso validado por', valor: 'horas_jornada' },
    { metrica: 'Cumplimiento validado sobre', valor: 'formatos operativos (excluye horas_jornada)' },
    { metrica: labels.total, valor: resumen.total_operarios ?? 0 },
    { metrica: labels.conActividad, valor: resumen.operarios_con_actividad ?? 0 },
    { metrica: labels.sinActividad, valor: resumen.operarios_sin_actividad ?? 0 },
    { metrica: 'Promedio cumplimiento %', valor: resumen.promedio_cumplimiento_pct ?? 0 },
    { metrica: labels.duplicados, valor: resumen.duplicados_detectados ?? 0 },
    { metrica: 'Personas-día sin ingreso', valor: workbookDatasets.ausencias_no_ingreso?.length ?? 0 },
    { metrica: 'Personas consolidadas en desempeño', valor: workbookDatasets.desempeno_por_persona?.length ?? 0 },
    { metrica: 'Destinatarios', valor: (configuracion.destinatarios || []).join(', ') || 'Sin configurar' }
  ];

  if (corteTipo === 'mensual' && resumen.metricas_persona_dia) {
    resumenRows.push(
      { metrica: 'Detalle auditado (persona-día)', valor: resumen.metricas_persona_dia.total_operarios ?? 0 },
      { metrica: 'Días con ingreso', valor: resumen.metricas_persona_dia.operarios_con_actividad ?? 0 },
      { metrica: 'Días sin ingreso', valor: resumen.metricas_persona_dia.operarios_sin_actividad ?? 0 },
      { metrica: 'Días con duplicados', valor: resumen.metricas_persona_dia.duplicados_detectados ?? 0 }
    );
  }

  return resumenRows;
}

function addResumenSheet(workbook, params) {
  const resumenSheet = workbook.addWorksheet('Resumen');
  resumenSheet.columns = [
    { header: 'Métrica', key: 'metrica', width: 40 },
    { header: 'Valor', key: 'valor', width: 32 }
  ];
  resumenSheet.addRows(buildResumenRows(params));
  applyHeaderStyle(resumenSheet);
}

function addDetalleSheet(workbook, rows) {
  const detalleSheet = workbook.addWorksheet('Detalle');
  detalleSheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Nombre Usuario', key: 'nombre', width: 28 },
    { header: 'Empresa', key: 'empresa', width: 22 },
    { header: 'Proyecto', key: 'nombre_proyecto', width: 28 },
    { header: 'Ingreso Registrado (horas_jornada)', key: 'actividad_registrada', width: 28 },
    { header: 'Cumplimiento % (sin horas_jornada)', key: 'cumplimiento_pct', width: 28 },
    { header: 'Total Registros', key: 'total_registros', width: 16 },
    { header: 'Formatos Llenos', key: 'formatos_llenos', width: 42 },
    { header: 'Formatos Operativos Llenos', key: 'formatos_operativos_llenos', width: 42 },
    { header: 'Formatos Operativos Faltantes', key: 'formatos_operativos_faltantes', width: 42 },
    { header: 'Formatos Faltantes Totales', key: 'formatos_faltantes', width: 42 },
    { header: 'Anomalías', key: 'anomalias', width: 42 }
  ];

  for (const row of rows) {
    detalleSheet.addRow({
      fecha: row.fecha,
      nombre: row.nombre,
      empresa: row.empresa || '',
      nombre_proyecto: row.nombre_proyecto || row.obra_nombre || '',
      actividad_registrada: toYesNo(row.actividad_registrada),
      cumplimiento_pct: Number(row.cumplimiento_pct ?? 0),
      total_registros: Number(row.total_registros ?? 0),
      formatos_llenos: toCommaList(row.formatos_llenos),
      formatos_operativos_llenos: toCommaList(row.formatos_operativos_llenos),
      formatos_operativos_faltantes: toCommaList(row.formatos_operativos_faltantes),
      formatos_faltantes: toCommaList(row.formatos_faltantes),
      anomalias: toCommaList(row.anomalias)
    });
  }

  applyHeaderStyle(detalleSheet);
}

function addAusenciasSheet(workbook, rows) {
  const ausenciasSheet = workbook.addWorksheet(AUSENCIAS_SHEET_NAME);
  ausenciasSheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Nombre Usuario', key: 'nombre', width: 28 },
    { header: 'Empresa', key: 'empresa', width: 22 },
    { header: 'Proyecto', key: 'nombre_proyecto', width: 28 },
    { header: 'Obra', key: 'obra_nombre', width: 28 },
    { header: 'Ingreso Registrado', key: 'actividad_registrada', width: 18 },
    { header: 'Total Registros', key: 'total_registros', width: 16 },
    { header: 'Formatos Llenos', key: 'formatos_llenos', width: 42 },
    { header: 'Formatos Operativos Llenos', key: 'formatos_operativos_llenos', width: 42 },
    { header: 'Formatos Operativos Faltantes', key: 'formatos_operativos_faltantes', width: 42 },
    { header: 'Anomalías', key: 'anomalias', width: 42 }
  ];

  for (const row of rows) {
    ausenciasSheet.addRow({
      fecha: row.fecha,
      nombre: row.nombre,
      empresa: row.empresa || '',
      nombre_proyecto: row.nombre_proyecto || row.obra_nombre || '',
      obra_nombre: row.obra_nombre || '',
      actividad_registrada: toYesNo(row.actividad_registrada),
      total_registros: Number(row.total_registros ?? 0),
      formatos_llenos: toCommaList(row.formatos_llenos),
      formatos_operativos_llenos: toCommaList(row.formatos_operativos_llenos),
      formatos_operativos_faltantes: toCommaList(row.formatos_operativos_faltantes),
      anomalias: toCommaList(row.anomalias)
    });
  }

  applyHeaderStyle(ausenciasSheet);
}

function addDesempenoSheet(workbook, rows) {
  const desempenoSheet = workbook.addWorksheet('Desempeño por persona');
  desempenoSheet.columns = [
    { header: 'Empresa', key: 'empresa', width: 22 },
    { header: 'Nombre Usuario', key: 'nombre', width: 28 },
    { header: 'Días evaluados', key: 'dias_evaluados', width: 16 },
    { header: 'Días con ingreso', key: 'dias_con_ingreso', width: 18 },
    { header: 'Días sin ingreso', key: 'dias_sin_ingreso', width: 18 },
    { header: 'Ingreso % período', key: 'ingreso_pct_periodo', width: 18 },
    { header: 'Formatos operativos esperados total', key: 'formatos_operativos_esperados_total', width: 28 },
    { header: 'Formatos operativos llenos total', key: 'formatos_operativos_llenos_total', width: 26 },
    { header: 'Cumplimiento % período', key: 'cumplimiento_pct_periodo', width: 22 },
    { header: 'Días con duplicados', key: 'dias_con_duplicados', width: 18 },
    { header: 'Días con registros', key: 'dias_con_registros', width: 18 },
    { header: 'Total registros período', key: 'total_registros_periodo', width: 22 },
    { header: 'Promedio cumplimiento persona-día %', key: 'promedio_cumplimiento_pct_persona_dia', width: 30 },
    { header: 'Proyectos / Obras', key: 'proyectos_obras', width: 42 },
    { header: 'Anomalías período', key: 'anomalias', width: 42 }
  ];

  for (const row of rows) {
    desempenoSheet.addRow({
      empresa: row.empresa || '',
      nombre: row.nombre,
      dias_evaluados: Number(row.dias_evaluados ?? 0),
      dias_con_ingreso: Number(row.dias_con_ingreso ?? 0),
      dias_sin_ingreso: Number(row.dias_sin_ingreso ?? 0),
      ingreso_pct_periodo: Number(row.ingreso_pct_periodo ?? 0),
      formatos_operativos_esperados_total: Number(row.formatos_operativos_esperados_total ?? 0),
      formatos_operativos_llenos_total: Number(row.formatos_operativos_llenos_total ?? 0),
      cumplimiento_pct_periodo: Number(row.cumplimiento_pct_periodo ?? 0),
      dias_con_duplicados: Number(row.dias_con_duplicados ?? 0),
      dias_con_registros: Number(row.dias_con_registros ?? 0),
      total_registros_periodo: Number(row.total_registros_periodo ?? 0),
      promedio_cumplimiento_pct_persona_dia: Number(row.promedio_cumplimiento_pct_persona_dia ?? 0),
      proyectos_obras: toCommaList(row.proyectos_obras),
      anomalias: toCommaList(row.anomalias)
    });
  }

  applyHeaderStyle(desempenoSheet);
}

function styleSectionTitle(cell) {
  cell.font = { bold: true, size: 12, color: { argb: 'FF102A43' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FF' } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    right: { style: 'thin', color: { argb: 'FFD9E2EC' } }
  };
}

function setKeyValueRow(worksheet, rowNumber, key, value, {
  keyColumn = 'B',
  valueColumn = 'C'
} = {}) {
  worksheet.getCell(`${keyColumn}${rowNumber}`).value = key;
  worksheet.getCell(`${valueColumn}${rowNumber}`).value = value;
  worksheet.getCell(`${keyColumn}${rowNumber}`).font = { bold: true, color: { argb: 'FF243B53' } };
  worksheet.getCell(`${valueColumn}${rowNumber}`).font = { color: { argb: 'FF243B53' } };
}

async function addComparativoIngresoSheet(workbook, {
  resumen,
  corteTipo,
  fechaCorte,
  fechaDesde,
  fechaHasta
}) {
  const comparativoSheet = workbook.addWorksheet(COMPARATIVO_INGRESO_SHEET_NAME);
  comparativoSheet.properties.defaultRowHeight = 22;
  comparativoSheet.columns = [
    { width: 4 },
    { width: 28 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 }
  ];

  comparativoSheet.mergeCells('B2:H2');
  comparativoSheet.getCell('B2').value = 'Comparativo ingreso';
  comparativoSheet.getCell('B2').font = { bold: true, size: 18, color: { argb: 'FF102A43' } };

  comparativoSheet.mergeCells('B3:H3');
  comparativoSheet.getCell('B3').value = corteTipo === 'mensual'
    ? 'La visual principal usa resumen mensual por persona única; el detalle persona-día queda como contexto.'
    : 'La visual principal usa el resumen diario consolidado del workbook.';
  comparativoSheet.getCell('B3').font = { italic: true, color: { argb: 'FF486581' } };

  styleSectionTitle(comparativoSheet.getCell('B5'));
  comparativoSheet.getCell('B5').value = 'Metadatos del corte';
  setKeyValueRow(comparativoSheet, 6, 'Tipo de corte', corteTipo);
  setKeyValueRow(comparativoSheet, 7, 'Fecha de corte', fechaCorte || '');
  setKeyValueRow(comparativoSheet, 8, 'Período consultado', fechaDesde && fechaHasta
    ? fechaDesde === fechaHasta
      ? fechaDesde
      : `${fechaDesde} a ${fechaHasta}`
    : fechaCorte || ''
  );
  setKeyValueRow(comparativoSheet, 9, 'Granularidad principal', resumen.granularidad_resumen ?? 'persona_dia');

  styleSectionTitle(comparativoSheet.getCell('F5'));
  comparativoSheet.getCell('F5').value = 'Base visual';
  setKeyValueRow(comparativoSheet, 6, 'Con ingreso', Number(resumen.operarios_con_actividad ?? 0), { keyColumn: 'F', valueColumn: 'G' });
  setKeyValueRow(comparativoSheet, 7, 'Sin ingreso', Number(resumen.operarios_sin_actividad ?? 0), { keyColumn: 'F', valueColumn: 'G' });
  setKeyValueRow(comparativoSheet, 8, 'Total evaluado', Number(resumen.total_operarios ?? 0), { keyColumn: 'F', valueColumn: 'G' });
  setKeyValueRow(comparativoSheet, 9, 'Promedio cumplimiento %', Number(resumen.promedio_cumplimiento_pct ?? 0), { keyColumn: 'F', valueColumn: 'G' });

  if (corteTipo === 'mensual' && resumen.metricas_persona_dia) {
    styleSectionTitle(comparativoSheet.getCell('B27'));
    comparativoSheet.getCell('B27').value = 'Contexto mensual (persona-día)';
    setKeyValueRow(comparativoSheet, 28, 'Detalle auditado', Number(resumen.metricas_persona_dia.total_operarios ?? 0));
    setKeyValueRow(comparativoSheet, 29, 'Días con ingreso', Number(resumen.metricas_persona_dia.operarios_con_actividad ?? 0));
    setKeyValueRow(comparativoSheet, 30, 'Días sin ingreso', Number(resumen.metricas_persona_dia.operarios_sin_actividad ?? 0));
    setKeyValueRow(comparativoSheet, 31, 'Días con duplicados', Number(resumen.metricas_persona_dia.duplicados_detectados ?? 0));
    comparativoSheet.mergeCells('B33:H33');
    comparativoSheet.getCell('B33').value = 'Nota: este bloque es solo contexto/auditoría. La barra principal no usa persona-día como base del comparativo mensual.';
    comparativoSheet.getCell('B33').font = { italic: true, color: { argb: 'FF486581' } };
  }

  const imageBuffer = await renderComparativoIngresoChart({ resumen, corteTipo });
  const imageId = workbook.addImage({
    buffer: imageBuffer,
    extension: 'png'
  });

  comparativoSheet.addImage(imageId, {
    tl: { col: 1.2, row: 10.2 },
    ext: { width: 960, height: 336 }
  });
}

async function generateWorkbookBuffer({
  rows,
  resumen = {},
  corteTipo = 'diario',
  fechaCorte,
  fechaDesde = fechaCorte,
  fechaHasta = fechaCorte,
  configuracion = {},
  workbookDatasets
}) {
  const datasets = workbookDatasets || buildFallbackWorkbookDatasets(rows);
  const resumenResolved = Object.keys(resumen || {}).length > 0
    ? resumen
    : buildFallbackResumen(datasets.detalle || rows, corteTipo);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  workbook.created = new Date();

  addResumenSheet(workbook, {
    resumen: resumenResolved,
    corteTipo,
    fechaCorte,
    fechaDesde,
    fechaHasta,
    configuracion,
    workbookDatasets: datasets
  });
  await addComparativoIngresoSheet(workbook, {
    resumen: datasets.resumen || resumenResolved,
    corteTipo,
    fechaCorte,
    fechaDesde,
    fechaHasta
  });
  addDetalleSheet(workbook, datasets.detalle || rows || []);
  addAusenciasSheet(workbook, datasets.ausencias_no_ingreso || []);
  addDesempenoSheet(workbook, datasets.desempeno_por_persona || []);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Crea un workbook ejecutivo del indicador central y lo retorna como Buffer.
 * Incluye las hojas Resumen, Comparativo ingreso, Detalle,
 * Ausencias - No ingreso y Desempeño por persona.
 * @param {{ rows: Array<object>, resumen: object, corteTipo: string, fechaCorte: string, fechaDesde?: string, fechaHasta?: string, configuracion?: object, workbookDatasets?: object }} params
 * @returns {Promise<Buffer>}
 */
export async function generateIndicadorCentralWorkbookBuffer(params) {
  return generateWorkbookBuffer(params);
}

/**
 * Crea el workbook compatible con el export manual de registros diarios.
 * Mantiene la misma composición ejecutiva del workbook del indicador central.
 * @param {{ rows: Array<object>, resumen?: object, corteTipo?: string, fechaCorte?: string, fechaDesde?: string, fechaHasta?: string, configuracion?: object, workbookDatasets?: object }} params
 * @returns {Promise<Buffer>}
 */
export async function generateRegistrosDiariosWorkbookBuffer({
  rows,
  resumen = {},
  corteTipo = 'diario',
  fechaCorte,
  fechaDesde,
  fechaHasta,
  configuracion = {},
  workbookDatasets
}) {
  const fallbackFecha = fechaCorte || fechaHasta || fechaDesde || '';
  return generateWorkbookBuffer({
    rows,
    resumen,
    corteTipo,
    fechaCorte: fallbackFecha,
    fechaDesde: fechaDesde || fallbackFecha,
    fechaHasta: fechaHasta || fallbackFecha,
    configuracion,
    workbookDatasets
  });
}
