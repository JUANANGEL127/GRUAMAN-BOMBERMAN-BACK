import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndicadorCentralDataset } from '../helpers/indicador_central.js';

function createDbStub({ aggregatedRows = [] } = {}) {
  const capturedSql = [];
  return {
    async query(sql) {
      capturedSql.push(sql);
      if (sql.includes('information_schema.columns')) {
        return { rows: [] };
      }
      if (sql.includes('FROM trabajadores t')) {
        return {
          rows: [
            {
              id: 1,
              nombre: 'Operario Uno',
              empresa_id: 1,
              obra_id: null,
              activo: true,
              nombre_obra: '',
              constructora: '',
              departamento_id: null
            }
          ]
        };
      }
      if (sql.includes('FROM empresas')) {
        return { rows: [{ id: 1, nombre: 'Empresa Uno' }] };
      }
      if (sql.includes('FROM trabajador_estado_temporal')) {
        return { rows: [] };
      }
      if (sql.includes('GROUP BY nombre, fecha') || sql.includes('FROM horas_jornada')) {
        return { rows: aggregatedRows };
      }
      return { rows: [] };
    },
    capturedSql
  };
}

const monthlyConfig = {
  formatos_por_empresa: {
    1: ['horas_jornada']
  },
  scope: {
    empresa_ids: [1],
    obra_id: null,
    obra_nombre: null,
    segmentar_por_obra: false,
    nombres: []
  },
  exclusiones: [],
  destinatarios: [],
  umbrales: {
    alerta_pct: 70,
    objetivo_pct: 90
  },
  distribucion_habilitada: false
};

test('monthly indicator skips festivo days without records', async () => {
  const dataset = await buildIndicadorCentralDataset({
    fechaDesde: '2026-05-01',
    fechaHasta: '2026-05-02',
    fechaCorte: '2026-05-02',
    corteTipo: 'mensual',
    configuracion: monthlyConfig,
    db: createDbStub()
  });

  assert.equal(dataset.rows.length, 1);
  assert.equal(dataset.rows.some((row) => row.fecha === '2026-05-01'), false);
  assert.equal(dataset.rows.some((row) => row.fecha === '2026-05-02'), true);
});

test('monthly indicator keeps festivo days when the worker actually has records', async () => {
  const dataset = await buildIndicadorCentralDataset({
    fechaDesde: '2026-05-01',
    fechaHasta: '2026-05-02',
    fechaCorte: '2026-05-02',
    corteTipo: 'mensual',
    configuracion: monthlyConfig,
    db: createDbStub({
      aggregatedRows: [
        {
          nombre: 'operario uno',
          fecha: '2026-05-01',
          nombre_proyecto: '',
          formatos_llenos: ['horas_jornada'],
          total_registros: 1
        },
        {
          nombre: 'operario uno',
          fecha: '2026-05-02',
          nombre_proyecto: '',
          formatos_llenos: ['horas_jornada'],
          total_registros: 1
        }
      ]
    })
  });

  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.rows.some((row) => row.fecha === '2026-05-01'), true);
  assert.equal(dataset.rows.some((row) => row.fecha === '2026-05-02'), true);
});

test('monthly indicator temporal novelty range query ignores closed rows', async () => {
  const db = createDbStub({
    aggregatedRows: [
      {
        nombre: 'operario uno',
        fecha: '2026-05-02',
        nombre_proyecto: '',
        formatos_llenos: ['horas_jornada'],
        total_registros: 1
      }
    ]
  });

  await buildIndicadorCentralDataset({
    fechaDesde: '2026-05-01',
    fechaHasta: '2026-05-02',
    fechaCorte: '2026-05-02',
    corteTipo: 'mensual',
    configuracion: monthlyConfig,
    db
  });

  assert.ok(db.capturedSql.some((sql) => sql.includes('FROM trabajador_estado_temporal')));
  assert.ok(db.capturedSql.some((sql) => /cerrado_at IS NULL/i.test(sql)));
  assert.ok(db.capturedSql.some((sql) => /anulado_at IS NULL/i.test(sql)));
});
