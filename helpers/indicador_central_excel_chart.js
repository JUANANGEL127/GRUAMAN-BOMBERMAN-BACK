import sharp from 'sharp';

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 420;
const COLORS = {
  ingreso: '#2E7D32',
  sinIngreso: '#C62828',
  background: '#F5F7FA',
  barBackground: '#D9E2EC',
  title: '#102A43',
  text: '#243B53',
  muted: '#486581',
  border: '#BCCCDC'
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatPercentage(value) {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSegment({
  label,
  value,
  percentage,
  color,
  x,
  y,
  width,
  height
}) {
  const safeWidth = Math.max(0, width);

  if (safeWidth <= 0) {
    return '';
  }

  const centerX = x + (safeWidth / 2);
  const canFitInside = safeWidth >= 150;
  const insideTextColor = '#FFFFFF';
  const outsideTextX = safeWidth < 120 ? x + safeWidth + 14 : centerX;
  const outsideAnchor = safeWidth < 120 ? 'start' : 'middle';

  return `
    <rect x="${x}" y="${y}" width="${safeWidth}" height="${height}" rx="18" fill="${color}" />
    <text
      x="${canFitInside ? centerX : outsideTextX}"
      y="${canFitInside ? y + 38 : y - 12}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="22"
      font-weight="700"
      fill="${canFitInside ? insideTextColor : COLORS.title}"
      text-anchor="${canFitInside ? 'middle' : outsideAnchor}"
    >${escapeXml(formatPercentage(percentage))}</text>
    <text
      x="${canFitInside ? centerX : outsideTextX}"
      y="${canFitInside ? y + 66 : y + 14}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="16"
      font-weight="500"
      fill="${canFitInside ? insideTextColor : COLORS.text}"
      text-anchor="${canFitInside ? 'middle' : outsideAnchor}"
    >${escapeXml(`${label}: ${value}`)}</text>
  `;
}

function buildLegendItem({ x, y, color, label, count, percentage }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="18" height="18" rx="4" fill="${color}" />
      <text
        x="${x + 28}"
        y="${y + 14}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="18"
        font-weight="600"
        fill="${COLORS.text}"
      >${escapeXml(`${label}: ${count} (${formatPercentage(percentage)})`)}</text>
    </g>
  `;
}

/**
 * Render the executive ingreso comparison chart as PNG bytes.
 * The chart always uses resumen totals as the primary source of truth.
 * @param {{
 *  resumen?: {
 *    total_operarios?: number,
 *    operarios_con_actividad?: number,
 *    operarios_sin_actividad?: number
 *  },
 *  corteTipo?: string,
 *  width?: number,
 *  height?: number
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderComparativoIngresoChart({
  resumen = {},
  corteTipo = 'diario',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
} = {}) {
  const declaredTotal = Math.max(
    0,
    Number(
      resumen.total_operarios
      ?? (Number(resumen.operarios_con_actividad ?? 0) + Number(resumen.operarios_sin_actividad ?? 0))
    ) || 0
  );
  const conIngreso = Math.max(0, Number(resumen.operarios_con_actividad ?? 0) || 0);
  const sinIngreso = Math.max(0, Number(resumen.operarios_sin_actividad ?? Math.max(declaredTotal - conIngreso, 0)) || 0);
  const total = Math.max(declaredTotal, conIngreso + sinIngreso);
  const normalizedTotal = total || 1;
  const ingresoPct = (conIngreso / normalizedTotal) * 100;
  const sinIngresoPct = (sinIngreso / normalizedTotal) * 100;
  const chartBaseLabel = corteTipo === 'mensual'
    ? 'Base principal: resumen mensual por persona única'
    : 'Base principal: resumen diario persona-día';

  const outerWidth = Math.max(900, width);
  const outerHeight = Math.max(320, height);
  const marginX = 60;
  const barX = marginX;
  const barY = 136;
  const barWidth = outerWidth - (marginX * 2);
  const barHeight = 92;
  const ingresoWidth = Math.round(barWidth * (ingresoPct / 100));
  const sinIngresoWidth = Math.max(0, barWidth - ingresoWidth);

  const svg = `
    <svg width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${outerWidth}" height="${outerHeight}" rx="28" fill="${COLORS.background}" />
      <rect x="24" y="24" width="${outerWidth - 48}" height="${outerHeight - 48}" rx="24" fill="#FFFFFF" stroke="${COLORS.border}" />

      <text x="${marginX}" y="72" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${COLORS.title}">
        Comparativo ingreso
      </text>
      <text x="${marginX}" y="104" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="${COLORS.muted}">
        ${escapeXml(chartBaseLabel)}
      </text>
      <text x="${outerWidth - marginX}" y="72" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="${COLORS.text}" text-anchor="end">
        ${escapeXml(`Total evaluado: ${total}`)}
      </text>

      <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="18" fill="${COLORS.barBackground}" />
      ${buildSegment({
        label: 'Con ingreso',
        value: conIngreso,
        percentage: ingresoPct,
        color: COLORS.ingreso,
        x: barX,
        y: barY,
        width: ingresoWidth,
        height: barHeight
      })}
      ${buildSegment({
        label: 'Sin ingreso',
        value: sinIngreso,
        percentage: sinIngresoPct,
        color: COLORS.sinIngreso,
        x: barX + ingresoWidth,
        y: barY,
        width: sinIngresoWidth,
        height: barHeight
      })}

      ${buildLegendItem({
        x: marginX,
        y: outerHeight - 120,
        color: COLORS.ingreso,
        label: 'Con ingreso',
        count: conIngreso,
        percentage: ingresoPct
      })}
      ${buildLegendItem({
        x: marginX + 360,
        y: outerHeight - 120,
        color: COLORS.sinIngreso,
        label: 'Sin ingreso',
        count: sinIngreso,
        percentage: sinIngresoPct
      })}

      <text x="${marginX}" y="${outerHeight - 54}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="${COLORS.muted}">
        La barra muestra distribución porcentual 100% apilada usando únicamente workbookDatasets.resumen.
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
