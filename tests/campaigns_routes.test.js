import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import { Blob } from "node:buffer";
import {
  createCampaignsRouter
} from "../routes/campaigns.js";
import {
  createAdminCampaignsRouter
} from "../routes/administrador/campaigns.js";
import { createCampaignsController } from "../controllers/campaignsController.js";

function createServiceStub() {
  const calls = {
    getActiveCampaign: [],
    getCampaignById: [],
    createCampaign: [],
    updateCampaign: [],
    patchCampaignStatus: [],
    archiveCampaign: []
  };

  return {
    calls,
    getActiveCampaign: async () => {
      calls.getActiveCampaign.push([]);
      return {
        id: 1,
        title: "Intro promo",
        enabled: true,
        permanent: true,
        startsAt: null,
        endsAt: null,
        archivedAt: null,
        status: "active",
        imageUrl: "/media/campaigns/intro-promo.webp",
        storageProvider: "render_disk",
        storageKey: "campaigns/intro-promo.webp",
        originalName: "intro-promo.webp",
        mimeType: "image/webp",
        size: 120
      };
    },
    getCampaignById: async (id) => {
      calls.getCampaignById.push([id]);
      return {
        id,
        title: "Intro promo",
        enabled: true,
        permanent: false,
        startsAt: "2026-06-17",
        endsAt: "2026-06-30",
        archivedAt: null,
        status: "active",
        imageUrl: "/media/campaigns/intro-promo.webp",
        storageProvider: "render_disk",
        storageKey: "campaigns/intro-promo.webp",
        originalName: "intro-promo.webp",
        mimeType: "image/webp",
        size: 120
      };
    },
    createCampaign: async (payload) => {
      calls.createCampaign.push(payload);
      return {
        id: 7,
        title: payload.title,
        enabled: payload.enabled,
        permanent: payload.permanent,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        archivedAt: null,
        imageUrl: "/media/campaigns/intro-promo.webp",
        storageProvider: "render_disk",
        storageKey: "campaigns/intro-promo.webp",
        originalName: payload.image?.originalname ?? null,
        mimeType: payload.image?.mimetype ?? null,
        size: payload.image?.size ?? null,
        status: "active"
      };
    },
    updateCampaign: async (id, payload) => {
      calls.updateCampaign.push([id, payload]);
      return {
        id,
        title: payload.title,
        enabled: payload.enabled,
        permanent: payload.permanent,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        archivedAt: null,
        imageUrl: "/media/campaigns/updated-promo.webp",
        storageProvider: "render_disk",
        storageKey: "campaigns/updated-promo.webp",
        originalName: payload.image?.originalname ?? null,
        mimeType: payload.image?.mimetype ?? null,
        size: payload.image?.size ?? null,
        status: "active"
      };
    },
    patchCampaignStatus: async (id, payload) => {
      calls.patchCampaignStatus.push([id, payload]);
      return {
        id,
        enabled: payload.enabled,
        status: payload.enabled ? "active" : "inactive"
      };
    },
    archiveCampaign: async (id) => {
      calls.archiveCampaign.push([id]);
      return {
        id,
        archivedAt: "2026-06-17T15:00:00Z",
        status: "archived"
      };
    }
  };
}

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return { server, baseUrl };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function createApp() {
  const service = createServiceStub();
  const controller = createCampaignsController({ service });
  const upload = multer({ storage: multer.memoryStorage() });
  const app = express();

  app.use(express.json());
  app.use("/campaigns", createCampaignsRouter({ campaignsController: controller }));
  app.use(
    "/administrador/campaigns",
    createAdminCampaignsRouter({ campaignsController: controller, uploadMiddleware: upload })
  );

  return { app, service };
}

test("GET /campaigns/active returns the current campaign", async () => {
  const { app, service } = createApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/campaigns/active`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.title, "Intro promo");
    assert.equal(body.imageUrl, "/media/campaigns/intro-promo.webp");
    assert.equal(body.status, "active");
    assert.equal(service.calls.getActiveCampaign.length, 1);
  } finally {
    await stopServer(server);
  }
});

test("GET /campaigns/active returns null when there is no active campaign", async () => {
  const { app, service } = createApp();
  service.getActiveCampaign = async () => {
    service.calls.getActiveCampaign.push([]);
    return null;
  };
  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/campaigns/active`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body, null);
    assert.equal(service.calls.getActiveCampaign.length, 1);
  } finally {
    await stopServer(server);
  }
});

test("POST /administrador/campaigns accepts multipart uploads and forwards the file", async () => {
  const { app, service } = createApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const form = new FormData();
    form.set("title", "Intro promo");
    form.set("enabled", "true");
    form.set("permanent", "true");
    form.set("image", new Blob([Buffer.from("banner-bytes")], { type: "image/webp" }), "banner.webp");

    const response = await fetch(`${baseUrl}/administrador/campaigns`, {
      method: "POST",
      body: form
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.imageUrl, "/media/campaigns/intro-promo.webp");
    assert.equal(service.calls.createCampaign.length, 1);
    assert.equal(service.calls.createCampaign[0].title, "Intro promo");
    assert.equal(service.calls.createCampaign[0].enabled, "true");
    assert.equal(service.calls.createCampaign[0].image.originalname, "banner.webp");
  } finally {
    await stopServer(server);
  }
});

test("GET /administrador/campaigns/:id returns a campaign by id", async () => {
  const { app, service } = createApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/administrador/campaigns/42`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, 42);
    assert.equal(body.status, "active");
    assert.equal(service.calls.getCampaignById[0][0], 42);
  } finally {
    await stopServer(server);
  }
});

test("PUT /administrador/campaigns/:id accepts multipart uploads for updates", async () => {
  const { app, service } = createApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const form = new FormData();
    form.set("title", "Updated promo");
    form.set("enabled", "true");
    form.set("permanent", "false");
    form.set("startsAt", "2026-06-17");
    form.set("endsAt", "2026-06-30");
    form.set("image", new Blob([Buffer.from("updated-bytes")], { type: "image/webp" }), "updated.webp");

    const response = await fetch(`${baseUrl}/administrador/campaigns/42`, {
      method: "PUT",
      body: form
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.title, "Updated promo");
    assert.equal(service.calls.updateCampaign.length, 1);
    assert.equal(service.calls.updateCampaign[0][0], 42);
    assert.equal(service.calls.updateCampaign[0][1].image.originalname, "updated.webp");
  } finally {
    await stopServer(server);
  }
});

test("PATCH /administrador/campaigns/:id/status and /archive map to the expected service calls", async () => {
  const { app, service } = createApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const statusResponse = await fetch(`${baseUrl}/administrador/campaigns/42/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    const statusBody = await statusResponse.json();

    const archiveResponse = await fetch(`${baseUrl}/administrador/campaigns/42/archive`, {
      method: "POST"
    });
    const archiveBody = await archiveResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.status, "inactive");
    assert.equal(archiveResponse.status, 200);
    assert.equal(archiveBody.status, "archived");
    assert.equal(service.calls.patchCampaignStatus[0][0], 42);
    assert.deepEqual(service.calls.patchCampaignStatus[0][1], { enabled: false });
    assert.equal(service.calls.archiveCampaign[0][0], 42);
  } finally {
    await stopServer(server);
  }
});
