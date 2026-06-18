import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIndicadorCentralMonthlyDateRange,
  buildIndicadorCentralMonthlyWorkingDays,
  buildIndicadorCentralWorkerTemporalExclusionClause,
  isIndicadorCentralHoliday,
  isIndicadorCentralWorkingDay,
  shouldIncludeIndicadorCentralMonthlyDay,
} from "../helpers/indicador_central.js";

test("Monday through Saturday are working days and Sunday is excluded", () => {
  assert.equal(isIndicadorCentralWorkingDay("2026-06-15"), true); // Monday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-16"), true); // Tuesday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-17"), true); // Wednesday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-18"), true); // Thursday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-19"), true); // Friday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-20"), true); // Saturday
  assert.equal(isIndicadorCentralWorkingDay("2026-06-21"), false); // Sunday
});

test("monthly date generation is cutoff-aware and bounded to the report month", () => {
  const dates = buildIndicadorCentralMonthlyDateRange("2026-06-17");

  assert.equal(dates[0], "2026-06-01");
  assert.equal(dates.at(-1), "2026-06-17");
  assert.ok(dates.includes("2026-06-15"));
  assert.equal(dates.includes("2026-06-18"), false);
  assert.equal(dates.includes("2026-07-01"), false);
  assert.equal(dates.length, 17);
});

test("monthly working days exclude Sundays", () => {
  const workingDays = buildIndicadorCentralMonthlyWorkingDays("2026-06-17");

  assert.equal(workingDays.includes("2026-06-07"), false);
  assert.equal(workingDays.includes("2026-06-14"), false);
  assert.equal(workingDays.includes("2026-06-01"), true);
  assert.equal(workingDays.includes("2026-06-06"), true);
});

test("holiday-aware monthly day rule excludes festivos without records and keeps worked festivos", () => {
  assert.equal(isIndicadorCentralHoliday("2026-05-01"), true);
  assert.equal(shouldIncludeIndicadorCentralMonthlyDay({
    fecha: "2026-05-01",
    hasTemporalNovelty: false,
    hasRecords: false
  }), false);
  assert.equal(shouldIncludeIndicadorCentralMonthlyDay({
    fecha: "2026-05-01",
    hasTemporalNovelty: false,
    hasRecords: true
  }), true);
  assert.equal(shouldIncludeIndicadorCentralMonthlyDay({
    fecha: "2026-05-01",
    hasTemporalNovelty: true,
    hasRecords: true
  }), false);
});

test("worker exclusion clause uses the supplied cutoff date and not NOW()", () => {
  const clause = buildIndicadorCentralWorkerTemporalExclusionClause("2026-06-17", 3);

  assert.equal(clause.cutoffDate, "2026-06-17");
  assert.match(clause.sql, /\$3::date/);
  assert.doesNotMatch(clause.sql, /NOW\(\)/i);
  assert.match(clause.sql, /cerrado_at IS NULL/i);
  assert.match(clause.sql, /anulado_at IS NULL/i);
});
