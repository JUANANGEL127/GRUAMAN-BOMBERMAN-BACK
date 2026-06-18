import test from "node:test";
import assert from "node:assert/strict";
import { createAdminUsuariosRouter } from "../routes/administrador/admin_usuarios.js";

function routePaths(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);
}

test("exposes catalog endpoints and annulment endpoint without shadowing static routes", () => {
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
      closeTemporalState: () => {},
      anularTemporalState: () => {}
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
  const expectedPaths = [
    "/temporal-motivos",
    "/temporal-motivos/:motiveId",
    "/temporal-motivos/:motiveId/activar",
    "/temporal-motivos/:motiveId/desactivar",
    "/estado-temporal/:id",
    "/estado-temporal/:id/:estadoTemporalId",
    "/estado-temporal/:id/:estadoTemporalId/cerrar",
    "/estado-temporal/:id/:estadoTemporalId/anular"
  ];

  for (const path of expectedPaths) {
    assert.ok(paths.includes(path), `missing route ${path}`);
  }

  assert.ok(paths.indexOf("/temporal-motivos") < paths.indexOf("/estado-temporal/:id"));
  assert.ok(paths.indexOf("/estado-temporal/:id") < paths.indexOf("/estado-temporal/:id/:estadoTemporalId"));
  assert.ok(paths.indexOf("/estado-temporal/:id/:estadoTemporalId") < paths.indexOf("/estado-temporal/:id/:estadoTemporalId/cerrar"));
  assert.ok(paths.indexOf("/estado-temporal/:id/:estadoTemporalId/cerrar") < paths.indexOf("/estado-temporal/:id/:estadoTemporalId/anular"));
});
