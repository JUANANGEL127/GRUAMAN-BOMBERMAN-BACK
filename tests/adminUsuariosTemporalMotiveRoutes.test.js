import test from "node:test";
import assert from "node:assert/strict";
import { createAdminUsuariosRouter } from "../routes/administrador/admin_usuarios.js";

function routePaths(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);
}

test("mounts catalog routes before temporal :id handlers to avoid shadowing", () => {
  const router = createAdminUsuariosRouter({
    temporalStateRepository: {
      findCurrentTemporalStatesByWorkerIds: async () => new Map()
    },
    temporalStateService: {
      listTemporalStatesForWorkers: async () => new Map()
    },
    temporalStateController: {
      getTemporalState: () => {},
      createTemporalState: () => {},
      updateTemporalState: () => {},
      closeTemporalState: () => {}
    },
    temporalMotiveController: {
      listTemporalMotives: () => {},
      createTemporalMotive: () => {},
      updateTemporalMotive: () => {},
      activateTemporalMotive: () => {},
      deactivateTemporalMotive: () => {}
    }
  });

  const paths = routePaths(router);
  const motiveIndex = paths.indexOf("/temporal-motivos");
  const temporalIndex = paths.indexOf("/estado-temporal/:id");
  const updateTemporalIndex = paths.indexOf("/estado-temporal/:id/:estadoTemporalId");

  assert.notEqual(motiveIndex, -1);
  assert.notEqual(temporalIndex, -1);
  assert.notEqual(updateTemporalIndex, -1);
  assert.ok(motiveIndex < temporalIndex);
  assert.ok(temporalIndex < updateTemporalIndex);
});
