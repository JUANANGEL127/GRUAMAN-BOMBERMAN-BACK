import test from "node:test";
import assert from "node:assert/strict";
import {
  CampaignsConfigError,
  createCampaignsConfig
} from "../config/campaignsConfig.js";
import {
  StorageProviderError,
  createStorageProvider
} from "../storage/storageProvider.js";

test("defaults campaigns storage to render_disk with sane limits", () => {
  const config = createCampaignsConfig({});

  assert.equal(config.storage.provider, "render_disk");
  assert.deepEqual(config.storage.allowedMimeTypes, [
    "image/jpeg",
    "image/png",
    "image/webp"
  ]);
  assert.equal(config.storage.maxUploadBytes, 5 * 1024 * 1024);
  assert.equal(
    config.storage.renderDisk.directory,
    "/opt/render/project/src/storage/campaigns"
  );
  assert.equal(config.storage.renderDisk.publicPath, "/media/campaigns");
});

test("parses custom campaigns storage limits and render disk location", () => {
  const config = createCampaignsConfig({
    CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER: "render_disk",
    CAMPAIGNS_ALLOWED_MIME_TYPES: "image/png, image/webp, image/png",
    CAMPAIGNS_UPLOAD_MAX_BYTES: "1048576",
    CAMPAIGNS_RENDER_DISK_DIR: "/mnt/campaigns-intro-promo",
    CAMPAIGNS_PUBLIC_BASE_URL: "https://cdn.example.test"
  });

  assert.deepEqual(config.storage.allowedMimeTypes, ["image/png", "image/webp"]);
  assert.equal(config.storage.maxUploadBytes, 1048576);
  assert.equal(config.storage.renderDisk.directory, "/mnt/campaigns-intro-promo");
  assert.equal(config.storage.renderDisk.publicBaseUrl, "https://cdn.example.test");
  assert.equal(config.storage.renderDisk.publicPath, "/media/campaigns");
});

test("rejects unknown campaigns storage providers deterministically", () => {
  assert.throws(
    () =>
      createCampaignsConfig({
        CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER: "s3"
      }),
    (error) =>
      error instanceof CampaignsConfigError &&
      error.message === "Unknown campaigns intro promo storage provider: s3"
  );
});

test("rejects non-positive upload size limits", () => {
  assert.throws(
    () =>
      createCampaignsConfig({
        CAMPAIGNS_UPLOAD_MAX_BYTES: "0"
      }),
    (error) =>
      error instanceof CampaignsConfigError &&
      error.message ===
        "CAMPAIGNS_UPLOAD_MAX_BYTES must be a positive integer"
  );
});

test("selects the render_disk storage provider from the parsed config", () => {
  const provider = createStorageProvider(createCampaignsConfig({}));

  assert.equal(typeof provider.upload, "function");
  assert.equal(typeof provider.delete, "function");
  assert.equal(typeof provider.getUrl, "function");
});

test("rejects unsupported providers at the factory boundary", () => {
  assert.throws(
    () =>
      createStorageProvider({
        storage: {
          provider: "s3"
        }
      }),
    (error) =>
      error instanceof StorageProviderError &&
      error.message === "Unknown campaigns intro promo storage provider: s3"
  );
});
