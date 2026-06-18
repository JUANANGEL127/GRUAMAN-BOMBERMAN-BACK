import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIndicadorCentralMonthlyCronCutoff,
  runIndicadorCentralMonthlyCronJob
} from "../helpers/indicador_central.js";

test("resolves the monthly cron cutoff explicitly from the cron day", () => {
  const cutoff = resolveIndicadorCentralMonthlyCronCutoff(new Date("2026-03-01T01:00:00-05:00"));
  assert.equal(cutoff, "2026-02-28");
});

test("monthly cron job passes an explicit cutoff date to the monthly indicator runner", async () => {
  let captured = null;

  await runIndicadorCentralMonthlyCronJob({
    now: new Date("2026-03-01T01:00:00-05:00"),
    db: { query: async () => ({ rows: [] }) },
    runIndicadorCentralCutoff: async (payload) => {
      captured = payload;
      return { ok: true };
    }
  });

  assert.equal(captured.corteTipo, "mensual_acumulado");
  assert.equal(captured.fechaCorte, "2026-02-28");
  assert.equal(captured.origen, "cron");
  assert.equal(captured.canal, "email");
});
