import sharp from "sharp";

const DEFAULT_WIDTH = 1320;
const DEFAULT_MIN_HEIGHT = 820;
const COLORS = {
  background: "#F5F7FA",
  panel: "#FFFFFF",
  panelBorder: "#D9E2EC",
  title: "#102A43",
  text: "#243B53",
  muted: "#486581",
  positive: "#2E7D32",
  negative: "#C62828",
  track: "#D9E2EC",
  total: "#1D4ED8",
};

const COMPARATIVE_ORDER = [
  {
    key: "total",
    label: "Total",
    subtitle: "Universo evaluado",
    aliases: ["total", "universo_total", "resumen_total"],
  },
  {
    key: "grua_man",
    label: "Grua Man",
    subtitle: "Empresa 1",
    aliases: ["grua_man", "grua man", "grua man", "empresa_1", "empresa1", "1"],
  },
  {
    key: "bomberman",
    label: "Bomberman",
    subtitle: "Empresa 2",
    aliases: ["bomberman", "empresa_2", "empresa2", "2"],
  },
];

function formatNumber(value) {
  return new Intl.NumberFormat("es-CO").format(Number(value) || 0);
}

function formatPercentage(value) {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric);
}

function pickFirst(source, keys = []) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeGranularityLabel(value, corteTipo) {
  const normalized = normalizeKey(value);
  if (normalized === "persona_unica_mensual") {
    return "Persona unica mensual";
  }
  if (normalized === "persona_dia") {
    return "Persona-dia";
  }

  return corteTipo === "mensual" || corteTipo === "mensual_acumulado"
    ? "Persona unica mensual"
    : "Persona-dia";
}

function buildDynamicComparativeDefinition(source) {
  const empresaId = Number(
    pickFirst(source, ["empresa_id", "empresaId"]),
  );
  const explicitKey = normalizeKey(
    pickFirst(source, [
      "key",
      "id",
      "slug",
      "name",
      "codigo",
      "comparativo",
      "segmento",
    ]) ||
      (Number.isInteger(empresaId) && empresaId > 0
        ? `empresa_${empresaId}`
        : "comparativo"),
  );
  const label =
    pickFirst(source, ["label", "nombre", "title", "titulo", "etiqueta"]) ||
    (Number.isInteger(empresaId) && empresaId > 0
      ? `Empresa ${empresaId}`
      : "Comparativo");
  const subtitle =
    pickFirst(source, [
      "subtitle",
      "subtitulo",
      "contexto",
      "granularidad_label",
    ]) ||
    (Number.isInteger(empresaId) && empresaId > 0
      ? `Empresa ${empresaId}`
      : "Comparativo");

  return {
    key: explicitKey,
    label,
    subtitle,
  };
}

function resolveComparativeDefinition(item) {
  const itemKey = normalizeKey(
    pickFirst(item, [
      "key",
      "id",
      "slug",
      "name",
      "codigo",
      "comparativo",
      "segmento",
      "empresa_id",
      "empresaId",
    ]),
  );
  const itemLabel = normalizeKey(
    pickFirst(item, ["label", "nombre", "title", "titulo", "etiqueta"]),
  );
  const itemEmpresaId = pickFirst(item, ["empresa_id", "empresaId"]);
  const normalizedEmpresaId = Number(itemEmpresaId);

  for (const definition of COMPARATIVE_ORDER) {
    const aliases = [
      definition.key,
      definition.label,
      ...(definition.aliases || []),
    ].map((alias) => normalizeKey(alias));
    if (aliases.includes(itemKey) || aliases.includes(itemLabel)) {
      return definition;
    }
  }

  if (normalizedEmpresaId === 1 || itemKey === "1") {
    return COMPARATIVE_ORDER[1];
  }
  if (normalizedEmpresaId === 2 || itemKey === "2") {
    return COMPARATIVE_ORDER[2];
  }

  return null;
}

function normalizeComparativeItem(item, fallbackDefinition, corteTipo) {
  const source = item && typeof item === "object" ? item : {};
  const nestedSummary =
    source.resumen && typeof source.resumen === "object"
      ? source.resumen
      : source;
  const definition =
    resolveComparativeDefinition(source) ||
    fallbackDefinition ||
    buildDynamicComparativeDefinition(source);
  const label =
    pickFirst(source, ["label", "nombre", "title", "titulo", "etiqueta"]) ||
    definition.label;
  const subtitle =
    pickFirst(source, [
      "subtitle",
      "subtitulo",
      "contexto",
      "granularidad_label",
    ]) || definition.subtitle;

  let conIngreso = toCount(
    pickFirst(nestedSummary, [
      "conIngreso",
      "con_ingreso",
      "operarios_con_actividad",
      "ingresos",
      "conActividad",
      "total_con_ingreso",
    ]),
  );
  let sinIngreso = toCount(
    pickFirst(nestedSummary, [
      "sinIngreso",
      "sin_ingreso",
      "operarios_sin_actividad",
      "sinActividad",
      "total_sin_ingreso",
    ]),
  );
  let total = toCount(
    pickFirst(nestedSummary, [
      "total",
      "total_operarios",
      "total_evaluados",
      "evaluados",
      "valor_total",
      "cantidad_total",
    ]),
  );

  if (total === 0 && (conIngreso > 0 || sinIngreso > 0)) {
    total = conIngreso + sinIngreso;
  }
  if (conIngreso === 0 && total > 0 && sinIngreso > 0) {
    conIngreso = Math.max(total - sinIngreso, 0);
  }
  if (sinIngreso === 0 && total > 0 && conIngreso > 0) {
    sinIngreso = Math.max(total - conIngreso, 0);
  }
  if (total < conIngreso + sinIngreso) {
    total = conIngreso + sinIngreso;
  }

  const effectiveTotal = total || conIngreso + sinIngreso;
  const conIngresoPct = effectiveTotal
    ? (conIngreso / effectiveTotal) * 100
    : 0;
  const sinIngresoPct = effectiveTotal
    ? (sinIngreso / effectiveTotal) * 100
    : 0;

  return {
    key: definition.key,
    label,
    subtitle,
    total: effectiveTotal,
    conIngreso,
    sinIngreso,
    conIngresoPct,
    sinIngresoPct,
    granularidad: normalizeGranularityLabel(
      pickFirst(source, [
        "granularidad",
        "granularidad_resumen",
        "contexto_granularidad",
      ]),
      corteTipo,
    ),
    raw: source,
  };
}

function collectComparatives(source, corteTipo, resumen) {
  const raw = source && typeof source === "object" ? source : {};
  const canonicalComparatives =
    Array.isArray(raw.comparativos) && raw.comparativos.length > 0
      ? raw.comparativos.map((item) =>
          normalizeComparativeItem(item, null, corteTipo),
        )
      : null;

  if (canonicalComparatives) {
    return canonicalComparatives;
  }

  const candidateCollections = [
    raw.comparativos,
    raw.items,
    raw.segmentos,
    raw.series,
  ].find((value) => Array.isArray(value) && value.length > 0);

  if (candidateCollections) {
    return candidateCollections.map((item) =>
      normalizeComparativeItem(item, resolveComparativeDefinition(item), corteTipo),
    );
  }

  const legacyComparatives = [];
  const legacyLookup = [
    { sourceKey: "total", definition: COMPARATIVE_ORDER[0] },
    { sourceKey: "grua_man", definition: COMPARATIVE_ORDER[1] },
    { sourceKey: "empresa_1", definition: COMPARATIVE_ORDER[1] },
    { sourceKey: "bomberman", definition: COMPARATIVE_ORDER[2] },
    { sourceKey: "empresa_2", definition: COMPARATIVE_ORDER[2] },
  ];

  for (const { sourceKey, definition } of legacyLookup) {
    const candidate = raw[sourceKey];
    if (candidate !== undefined && candidate !== null) {
      legacyComparatives.push(
        normalizeComparativeItem(candidate, definition, corteTipo),
      );
    }
  }

  if (legacyComparatives.length > 0) {
    return legacyComparatives;
  }

  const totalResumen = {
    total_operarios:
      resumen.total_operarios ??
      Number(resumen.operarios_con_actividad ?? 0) +
        Number(resumen.operarios_sin_actividad ?? 0),
    operarios_con_actividad: resumen.operarios_con_actividad ?? 0,
    operarios_sin_actividad: resumen.operarios_sin_actividad ?? 0,
  };

  return [
    normalizeComparativeItem(
      {
        key: "total",
        label: "Total",
        resumen: totalResumen,
      },
      COMPARATIVE_ORDER[0],
      corteTipo,
    ),
  ];
}

function normalizeComparativoIngresoVisual({
  visual,
  resumen = {},
  corteTipo = "diario",
} = {}) {
  const source = visual && typeof visual === "object" ? visual : {};
  const comparatives = collectComparatives(source, corteTipo, resumen);
  const isMonthly =
    corteTipo === "mensual" || corteTipo === "mensual_acumulado";
  const sourceLabel =
    pickFirst(source, ["source_label", "fuente", "origin", "origen"]) ||
    (visual ? "workbookDatasets.comparativo_ingreso_visual" : "fallback");
  const granularidad =
    pickFirst(source, [
      "granularidad",
      "granularidad_resumen",
      "contexto_granularidad",
    ]) ||
    (comparatives[0]?.granularidad ??
      (isMonthly ? "Persona unica mensual" : "Persona-dia"));

  return {
    title: pickFirst(source, ["title", "titulo"]) || "Comparativo ingreso",
    subtitle:
      pickFirst(source, ["subtitle", "subtitulo"]) ||
      (isMonthly
        ? "Base principal: resumen mensual por persona unica"
        : "Base principal: resumen diario persona-dia"),
    sourceLabel,
    granularidad,
    comparativos: comparatives,
    raw: source,
  };
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
      >${escapeXml(`${label}: ${formatNumber(count)} (${formatPercentage(percentage)})`)}</text>
    </g>
  `;
}

function buildSegment({
  label,
  value,
  percentage,
  color,
  x,
  y,
  width,
  height,
  containerRight,
  isLeftSegment,
}) {
  const safeWidth = Math.max(0, width);
  if (safeWidth <= 0) {
    return "";
  }

  const centerX = x + safeWidth / 2;

  const centerY = y + height / 2;
  const canFitInside = safeWidth >= 180;

  const insideTextColor = "#FFFFFF";

  const outsideTextXRaw = x + safeWidth + 14;
  const outsideTextX = Math.min(outsideTextXRaw, containerRight - 16);

  const outsideYOffset = isLeftSegment ? 18 : 38;

  return `
    <rect x="${x}" y="${y}" width="${safeWidth}" height="${height}" rx="18" fill="${color}" />

    <text
      x="${canFitInside ? centerX : outsideTextX}"
      y="${canFitInside ? centerY - 8 : y + height + outsideYOffset}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="20"
      font-weight="700"
      fill="${canFitInside ? insideTextColor : COLORS.title}"
      text-anchor="${canFitInside ? "middle" : "start"}"
      dominant-baseline="middle"
    >${escapeXml(formatPercentage(percentage))}</text>

    <text
      x="${canFitInside ? centerX : outsideTextX}"
      y="${canFitInside ? centerY + 8 : y + height + outsideYOffset + 18}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="14"
      font-weight="500"
      fill="${canFitInside ? insideTextColor : COLORS.text}"
      text-anchor="${canFitInside ? "middle" : "start"}"
      dominant-baseline="middle"
    >${escapeXml(`${label}: ${formatNumber(value)}`)}</text>
  `;
}

function measureComparativeCardHeight(comparative, width) {
  const barWidth = width - 48;
  const total = Math.max(0, Number(comparative.total) || 0);
  const conIngreso = Math.max(0, Number(comparative.conIngreso) || 0);
  const sinIngreso = Math.max(0, Number(comparative.sinIngreso) || 0);
  const totalForChart = Math.max(total, conIngreso + sinIngreso) || 1;
  const conWidth = Math.round(barWidth * (conIngreso / totalForChart));
  const sinWidth = Math.round(barWidth * (sinIngreso / totalForChart));
  const needsExtraHeight = conWidth < 180 || sinWidth < 180;
  return 140 + (needsExtraHeight ? 40 : 0);
}

function buildComparativeCard({ comparative, x, y, width, cardHeight }) {
  const barX = x + 24;
  const barY = y + 54;
  const barWidth = width - 48;
  const barHeight = 44;
  const total = Math.max(0, Number(comparative.total) || 0);
  const conIngreso = Math.max(0, Number(comparative.conIngreso) || 0);
  const sinIngreso = Math.max(0, Number(comparative.sinIngreso) || 0);
  const totalForChart = Math.max(total, conIngreso + sinIngreso) || 1;
  const resolvedCardHeight = cardHeight ?? measureComparativeCardHeight(comparative, width);

  let sinWidth = Math.round(barWidth * (sinIngreso / totalForChart));
  let conWidth = Math.round(barWidth * (conIngreso / totalForChart));

  if (conIngreso > 0 && conWidth === 0) conWidth = 4;
  if (sinIngreso > 0 && sinWidth === 0) sinWidth = 4;
  if (conWidth + sinWidth > barWidth) {
    const overflow = conWidth + sinWidth - barWidth;
    if (sinWidth >= conWidth) {
      sinWidth = Math.max(0, sinWidth - overflow);
    } else {
      conWidth = Math.max(0, conWidth - overflow);
    }
  }

  const summaryText =
    total > 0
      ? `Con ingreso: ${formatNumber(conIngreso)} - Sin ingreso: ${formatNumber(sinIngreso)} - Total: ${formatNumber(total)}`
      : "Sin datos suficientes para segmentar el comparativo";

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${resolvedCardHeight}" rx="20" fill="${COLORS.panel}" stroke="${COLORS.panelBorder}" />
    <text
      x="${x + 24}"
      y="${y + 32}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="22"
      font-weight="700"
      fill="${COLORS.title}"
      dominant-baseline="middle"
    >${escapeXml(comparative.label)}</text>
    <text
      x="${x + width - 24}"
      y="${y + 32}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="18"
      font-weight="600"
      fill="${COLORS.text}"
      dominant-baseline="middle"
      text-anchor="end"
    >${escapeXml(`Total evaluado: ${formatNumber(total)}`)}</text>
    <text
      x="${x + 24}"
      y="${y + 48}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="14"
      font-weight="500"
      fill="${COLORS.muted}"
    >${escapeXml(`${comparative.subtitle} - ${comparative.granularidad}`)}</text>

    <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="18" fill="${COLORS.track}" />
    ${
      total > 0
        ? `${buildSegment({
            label: "Con ingreso",
            value: conIngreso,
            percentage: (conIngreso / totalForChart) * 100,
            color: comparative.key === "total" ? COLORS.total : COLORS.positive,
            x: barX,
            y: barY,
            width: conWidth,
            height: barHeight,
            containerRight: x + width,
            isLeftSegment: true,
          })}
          ${buildSegment({
            label: "Sin ingreso",
            value: sinIngreso,
            percentage: (sinIngreso / totalForChart) * 100,
            color: COLORS.negative,
            x: barX + conWidth,
            y: barY,
            width: sinWidth,
            height: barHeight,
            containerRight: x + width,
            isLeftSegment: false,
          })}`
        : `
          <text
            x="${barX + barWidth / 2}"
            y="${barY + 22}"
            font-family="Arial, Helvetica, sans-serif"
            font-size="16"
            font-weight="600"
            fill="${COLORS.muted}"
            text-anchor="middle"
          >Sin datos suficientes para dibujar la barra</text>
        `
    }

    <text
      x="${x + 24}"
      y="${y + 114}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="15"
      font-weight="500"
      fill="${COLORS.text}"
    >${escapeXml(summaryText)}</text>
  `;
}

function buildGlobalNote({ comparatives, sourceLabel, granularidad }) {
  const comparativeList = comparatives.map((item) => item.label).join(" - ");
  const sourceText =
    sourceLabel === "fallback"
      ? "Fallback derivado desde resumen"
      : "Payload visual compartido";
  const comparativeCount = comparatives.length;
  const comparativeCountText =
    comparativeCount === 1
      ? "1 comparativo renderizado"
      : `${comparativeCount} comparativos renderizados`;

  return `${comparativeCountText}: ${comparativeList}. ${sourceText}. ${granularidad}.`;
}

/**
 * Render the executive ingreso comparison chart as PNG bytes.
 * It consumes a shared visual payload when available and falls back to the summary contract.
 * @param {{
 *  visual?: object,
 *  resumen?: {
 *    total_operarios?: number,
 *    operarios_con_actividad?: number,
 *    operarios_sin_actividad?: number,
 *    granularidad_resumen?: string
 *  },
 *  corteTipo?: string,
 *  width?: number,
 *  height?: number
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderComparativoIngresoChart({
  visual,
  resumen = {},
  corteTipo = "diario",
  width = DEFAULT_WIDTH,
  height = DEFAULT_MIN_HEIGHT,
} = {}) {
  const payload = normalizeComparativoIngresoVisual({
    visual,
    resumen,
    corteTipo,
  });
  const outerWidth = Math.max(1120, Number(width) || DEFAULT_WIDTH);
  const headerHeight = 118;
  const cardGap = 16;
  const footerHeight = 84;
  const marginX = 48;
  const cardWidth = outerWidth - marginX * 2;
  const cardHeights = payload.comparativos.map((comparative) =>
    measureComparativeCardHeight(comparative, cardWidth),
  );
  const totalCardsHeight = cardHeights.reduce((acc, value) => acc + value, 0);
  const totalGaps = Math.max(0, payload.comparativos.length - 1) * cardGap;
  const computedHeight = headerHeight + totalCardsHeight + totalGaps + footerHeight;
  const outerHeight = Math.max(
    DEFAULT_MIN_HEIGHT,
    Number(height) || DEFAULT_MIN_HEIGHT,
    computedHeight,
  );

  let currentY = headerHeight;
  const cards = payload.comparativos
    .map((comparative, index) => {
      const cardHeight = cardHeights[index];
      const card = buildComparativeCard({
        comparative,
        x: marginX,
        y: currentY,
        width: cardWidth,
        cardHeight,
      });
      currentY += cardHeight + cardGap;
      return card;
    })
    .join("\n");

  const footerY = headerHeight + totalCardsHeight + totalGaps + 30;
  const globalNote = buildGlobalNote({
    comparatives: payload.comparativos,
    sourceLabel: payload.sourceLabel,
    granularidad: payload.granularidad,
  });

  const svg = `
    <svg width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${outerWidth}" height="${outerHeight}" rx="28" fill="${COLORS.background}" />
      <rect x="24" y="24" width="${outerWidth - 48}" height="${outerHeight - 48}" rx="24" fill="${COLORS.panel}" stroke="${COLORS.panelBorder}" />

      <text x="${marginX}" y="68" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${COLORS.title}">
        ${escapeXml(payload.title)}
      </text>
      <text x="${marginX}" y="100" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="${COLORS.muted}">
        ${escapeXml(payload.subtitle)}
      </text>
      <text x="${outerWidth - marginX}" y="68" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="${COLORS.text}" text-anchor="end">
        ${escapeXml(`${payload.granularidad} - ${payload.sourceLabel}`)}
      </text>
      <text x="${outerWidth - marginX}" y="100" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="${COLORS.text}" text-anchor="end">
        ${escapeXml(`Comparativos: ${payload.comparativos.map((item) => item.label).join(" - ")}`)}
      </text>

      ${cards}

      ${buildLegendItem({
        x: marginX,
        y: footerY,
        color: COLORS.positive,
        label: "Con ingreso",
        count: payload.comparativos.reduce(
          (acc, item) => acc + item.conIngreso,
          0,
        ),
        percentage:
          (payload.comparativos.reduce(
            (acc, item) => acc + item.conIngreso,
            0,
          ) /
            Math.max(
              1,
              payload.comparativos.reduce((acc, item) => acc + item.total, 0),
            )) *
          100,
      })}
      ${buildLegendItem({
        x: marginX + 310,
        y: footerY,
        color: COLORS.negative,
        label: "Sin ingreso",
        count: payload.comparativos.reduce(
          (acc, item) => acc + item.sinIngreso,
          0,
        ),
        percentage:
          (payload.comparativos.reduce(
            (acc, item) => acc + item.sinIngreso,
            0,
          ) /
            Math.max(
              1,
              payload.comparativos.reduce((acc, item) => acc + item.total, 0),
            )) *
          100,
      })}

      <text x="${marginX}" y="${outerHeight - 40}" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="${COLORS.muted}">
        ${escapeXml(globalNote)}
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export { normalizeComparativoIngresoVisual };
