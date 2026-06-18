import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DEFAULT_PUBLIC_PATH = "/campaigns-intro-promo";
const DEFAULT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const MIME_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);

export class RenderDiskProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = "RenderDiskProviderError";
  }
}

function normalizeMountDir(value) {
  const mountDir = String(value || "").trim();
  if (mountDir === "") {
    throw new TypeError("mountDir is required");
  }

  return mountDir;
}

function normalizePublicPath(value) {
  const rawPath = String(value || DEFAULT_PUBLIC_PATH).trim();
  const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

function normalizeAllowedMimeTypes(value) {
  const list = Array.isArray(value) && value.length > 0 ? value : DEFAULT_ALLOWED_MIME_TYPES;
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function normalizeMaxUploadBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  return parsed;
}

function assertStorageKey(storageKey) {
  if (typeof storageKey !== "string" || storageKey.trim() === "") {
    throw new TypeError("storageKey must be a non-empty string");
  }

  const normalized = storageKey.trim();
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    throw new TypeError("storageKey must be a relative file name");
  }

  return normalized;
}

function resolveExtension(file) {
  const originalName = String(file?.originalname || "");
  const originalExtension = extname(originalName).replace(".", "").toLowerCase();
  if (originalExtension) return originalExtension;

  const mimeType = String(file?.mimetype || "").toLowerCase();
  return MIME_TYPE_EXTENSIONS.get(mimeType) || "bin";
}

async function resolveBytes(file) {
  if (Buffer.isBuffer(file?.buffer)) {
    return file.buffer;
  }

  if (file?.buffer instanceof Uint8Array) {
    return Buffer.from(file.buffer);
  }

  if (typeof file?.path === "string" && file.path) {
    return readFile(file.path);
  }

  throw new TypeError("file.buffer or file.path is required to upload a campaign asset");
}

function resolveSize(file, bytes) {
  if (Number.isFinite(file?.size) && file.size >= 0) {
    return file.size;
  }

  return bytes.length;
}

function buildImageUrl({ baseUrl, publicPath, storageKey }) {
  const relativePath = `${publicPath.replace(/^\/+/, "")}/${encodeURIComponent(storageKey)}`;
  if (!baseUrl) {
    return `/${relativePath}`;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(baseUrl)) {
    return new URL(relativePath, `${baseUrl.replace(/\/+$/, "")}/`).toString();
  }

  const normalizedBasePath = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return `${normalizedBasePath.replace(/\/+$/, "")}/${relativePath}`;
}

export function createRenderDiskProvider(options = {}) {
  const mountDir = normalizeMountDir(options.mountDir ?? options.directory);
  const publicPath = normalizePublicPath(options.publicPath);
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl);
  const allowedMimeTypes = normalizeAllowedMimeTypes(options.allowedMimeTypes);
  const maxUploadBytes = normalizeMaxUploadBytes(options.maxUploadBytes);
  const randomId = typeof options.randomId === "function" ? options.randomId : randomUUID;

  return {
    async upload(file) {
      const mimeType = String(file?.mimetype || "").toLowerCase();
      if (!allowedMimeTypes.includes(mimeType)) {
        throw new RenderDiskProviderError(`Unsupported mime type: ${file?.mimetype || "unknown"}`);
      }

      const bytes = await resolveBytes(file);
      if (bytes.length > maxUploadBytes) {
        throw new RenderDiskProviderError("File exceeds the configured upload limit");
      }

      const storageKey = `campaigns-${randomId()}.${resolveExtension(file)}`;
      const filePath = join(mountDir, storageKey);

      await mkdir(mountDir, { recursive: true });
      await writeFile(filePath, bytes);

      return {
        storageKey,
        imageUrl: buildImageUrl({ baseUrl: publicBaseUrl, publicPath, storageKey }),
        originalName: file?.originalname || null,
        mimeType: file?.mimetype || null,
        size: resolveSize(file, bytes)
      };
    },

    async delete(storageKey) {
      const normalizedStorageKey = assertStorageKey(storageKey);
      await rm(join(mountDir, normalizedStorageKey), { force: true });
    },

    getUrl(storageKey) {
      const normalizedStorageKey = assertStorageKey(storageKey);
      return buildImageUrl({
        baseUrl: publicBaseUrl,
        publicPath,
        storageKey: normalizedStorageKey
      });
    }
  };
}
