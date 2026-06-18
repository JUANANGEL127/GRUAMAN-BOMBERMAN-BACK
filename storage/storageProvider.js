import { createRenderDiskProvider } from "./renderDiskProvider.js";

export class StorageProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageProviderError";
  }
}

export function createStorageProvider(config) {
  const storageConfig = config?.storage;
  const provider = String(storageConfig?.provider || "").trim();

  if (provider === "render_disk") {
    const renderDiskConfig = storageConfig.renderDisk || {};
    return createRenderDiskProvider({
      mountDir: renderDiskConfig.mountDir || renderDiskConfig.directory,
      directory: renderDiskConfig.directory || renderDiskConfig.mountDir,
      publicBaseUrl: renderDiskConfig.publicBaseUrl,
      publicPath: renderDiskConfig.publicPath,
      allowedMimeTypes: storageConfig.allowedMimeTypes,
      maxUploadBytes: storageConfig.maxUploadBytes
    });
  }

  throw new StorageProviderError(`Unknown campaigns intro promo storage provider: ${provider || "unknown"}`);
}
