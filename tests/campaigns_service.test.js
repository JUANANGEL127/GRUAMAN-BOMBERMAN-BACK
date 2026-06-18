import test from "node:test";
import assert from "node:assert/strict";
import {
  createCampaignsService,
  deriveCampaignStatus
} from "../services/campaignsService.js";

function createRepositoryStub(overrides = {}) {
  const repository = {
    findById: async () => null,
    findActiveCampaign: async () => null,
    findConflictingEffectiveCampaign: async () => null,
    createCampaign: async (campaign) => ({ id: 1, ...campaign }),
    updateCampaign: async (id, campaign) => ({ id, ...campaign }),
    patchCampaignStatus: async (id, enabled) => ({ id, enabled }),
    archiveCampaign: async (id, archivedAt) => ({ id, archivedAt })
  };

  Object.assign(repository, overrides);
  repository.transaction = async (work) => work(repository);
  return repository;
}

function createStorageProviderStub(overrides = {}) {
  return {
    upload: async () => ({
      storageKey: "campaigns/mock-banner.webp",
      imageUrl: "/media/campaigns/mock-banner.webp",
      originalName: "banner.webp",
      mimeType: "image/webp",
      size: 128
    }),
    delete: async () => undefined,
    getUrl: (storageKey) => `/media/campaigns/${storageKey}`,
    ...overrides
  };
}

test("deriveCampaignStatus resolves active lifecycle states", () => {
  assert.equal(
    deriveCampaignStatus(
      { enabled: true, permanent: true, startsAt: null, endsAt: null, archivedAt: null },
      new Date("2026-06-17T12:00:00Z")
    ),
    "active"
  );
  assert.equal(
    deriveCampaignStatus(
      {
        enabled: true,
        permanent: false,
        startsAt: "2026-06-18",
        endsAt: "2026-06-30",
        archivedAt: null
      },
      new Date("2026-06-17T12:00:00Z")
    ),
    "scheduled"
  );
  assert.equal(
    deriveCampaignStatus(
      {
        enabled: true,
        permanent: false,
        startsAt: "2026-06-01",
        endsAt: "2026-06-10",
        archivedAt: null
      },
      new Date("2026-06-17T12:00:00Z")
    ),
    "inactive"
  );
  assert.equal(
    deriveCampaignStatus(
      {
        enabled: false,
        permanent: true,
        startsAt: null,
        endsAt: null,
        archivedAt: "2026-06-17T15:00:00Z"
      },
      new Date("2026-06-17T12:00:00Z")
    ),
    "archived"
  );
});

test("createCampaign uploads the image, stores normalized metadata, and returns imageUrl", async () => {
  const uploadCalls = [];
  const repository = createRepositoryStub({
    createCampaign: async (campaign) => ({
      id: 7,
      title: campaign.title,
      enabled: campaign.enabled,
      permanent: campaign.permanent,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      archivedAt: campaign.archivedAt,
      imageUrl: campaign.imageUrl,
      storageProvider: campaign.storageProvider,
      storageKey: campaign.storageKey,
      originalName: campaign.originalName,
      mimeType: campaign.mimeType,
      size: campaign.size,
      createdAt: "2026-06-17T13:00:00Z",
      updatedAt: "2026-06-17T13:00:00Z"
    })
  });
  const storageProvider = createStorageProviderStub({
    upload: async (file) => {
      uploadCalls.push(file);
      return {
        storageKey: "campaigns/intro-promo.webp",
        imageUrl: "/media/campaigns/intro-promo.webp",
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      };
    }
  });
  const service = createCampaignsService({
    repository,
    storageProvider,
    storageProviderName: "render_disk",
    clock: () => new Date("2026-06-17T12:00:00Z")
  });

  const result = await service.createCampaign({
    title: "Intro promo",
    enabled: "true",
    permanent: "true",
    startsAt: "",
    endsAt: "",
    image: {
      originalname: "banner.webp",
      mimetype: "image/webp",
      size: 128,
      buffer: Buffer.from("banner-bytes")
    }
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(result.id, 7);
  assert.equal(result.status, "active");
  assert.equal(result.imageUrl, "/media/campaigns/intro-promo.webp");
  assert.equal(result.storageProvider, "render_disk");
  assert.equal(result.storageKey, "campaigns/intro-promo.webp");
  assert.equal(result.originalName, "banner.webp");
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.size, 128);
  assert.ok(!("thumbnail" in result));
  assert.equal(result.startsAt, null);
  assert.equal(result.endsAt, null);
});

test("createCampaign rejects overlapping effective campaigns before uploading", async () => {
  let uploadCount = 0;
  const service = createCampaignsService({
    repository: createRepositoryStub({
      findConflictingEffectiveCampaign: async () => ({ id: 9, title: "Existing promo" })
    }),
    storageProvider: createStorageProviderStub({
      upload: async () => {
        uploadCount += 1;
        return {};
      }
    }),
    clock: () => new Date("2026-06-17T12:00:00Z")
  });

  await assert.rejects(
    () =>
      service.createCampaign({
        title: "Intro promo",
        enabled: true,
        permanent: false,
        startsAt: "2026-06-18",
        endsAt: "2026-06-30",
        image: {
          originalname: "banner.webp",
          mimetype: "image/webp",
          size: 128,
          buffer: Buffer.from("banner-bytes")
        }
      }),
    (error) => error?.status === 409 && error?.code === "CAMPAIGN_OVERLAP"
  );

  assert.equal(uploadCount, 0);
});

test("createCampaign rejects missing images and invalid date windows", async () => {
  const service = createCampaignsService({
    repository: createRepositoryStub(),
    storageProvider: createStorageProviderStub(),
    clock: () => new Date("2026-06-17T12:00:00Z")
  });

  await assert.rejects(
    () =>
      service.createCampaign({
        title: "Intro promo",
        enabled: true,
        permanent: true,
        startsAt: null,
        endsAt: null,
        image: null
      }),
    (error) => error?.status === 400 && /image/i.test(error.message)
  );

  await assert.rejects(
    () =>
      service.createCampaign({
        title: "Intro promo",
        enabled: true,
        permanent: false,
        startsAt: "2026-06-20",
        endsAt: "2026-06-18",
        image: {
          originalname: "banner.webp",
          mimetype: "image/webp",
          size: 128,
          buffer: Buffer.from("banner-bytes")
        }
      }),
    (error) => error?.status === 400 && /startsAt/i.test(error.message)
  );
});

test("updateCampaign can replace or preserve image metadata depending on the payload", async () => {
  const repository = createRepositoryStub({
    findById: async () => ({
      id: 3,
      title: "Existing promo",
      enabled: true,
      permanent: false,
      startsAt: "2026-06-17",
      endsAt: "2026-06-30",
      archivedAt: null,
      storageProvider: "render_disk",
      storageKey: "campaigns/old.webp",
      imageUrl: "/media/campaigns/old.webp",
      originalName: "old.webp",
      mimeType: "image/webp",
      size: 88,
      createdAt: "2026-06-01T12:00:00Z",
      updatedAt: "2026-06-01T12:00:00Z"
    }),
    updateCampaign: async (_id, campaign) => ({
      id: 3,
      ...campaign,
      createdAt: "2026-06-01T12:00:00Z",
      updatedAt: "2026-06-17T12:30:00Z"
    })
  });
  const service = createCampaignsService({
    repository,
    storageProvider: createStorageProviderStub({
      upload: async () => ({
        storageKey: "campaigns/new.webp",
        imageUrl: "/media/campaigns/new.webp",
        originalName: "new.webp",
        mimeType: "image/webp",
        size: 99
      })
    }),
    storageProviderName: "render_disk",
    clock: () => new Date("2026-06-17T12:00:00Z")
  });

  const updated = await service.updateCampaign(3, {
    title: "Updated promo",
    enabled: true,
    permanent: false,
    startsAt: "2026-06-17",
    endsAt: "2026-06-30",
    image: {
      originalname: "new.webp",
      mimetype: "image/webp",
      size: 99,
      buffer: Buffer.from("new-bytes")
    }
  });

  assert.equal(updated.title, "Updated promo");
  assert.equal(updated.imageUrl, "/media/campaigns/new.webp");
  assert.equal(updated.status, "active");

  const preserved = await service.updateCampaign(3, {
    title: "Updated again",
    enabled: true,
    permanent: false,
    startsAt: "2026-06-17",
    endsAt: "2026-06-30"
  });

  assert.equal(preserved.title, "Updated again");
  assert.equal(preserved.imageUrl, "/media/campaigns/old.webp");
  assert.equal(preserved.storageKey, "campaigns/old.webp");
});
