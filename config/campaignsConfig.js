import multer from "multer";

const DEFAULT_STORAGE_PROVIDER = "render_disk";
const DEFAULT_RENDER_DISK_DIR = "/opt/render/project/src/storage/campaigns";
const DEFAULT_PUBLIC_PATH = "/media/campaigns";
const DEFAULT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export class CampaignsConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "CampaignsConfigError";
  }
}

function getFirstDefined(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (value != null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function parsePositiveInteger(value, fallback, envName) {
  if (value == null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CampaignsConfigError(`${envName} must be a positive integer`);
  }

  return parsed;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeProvider(value) {
  const provider = String(value || DEFAULT_STORAGE_PROVIDER).trim().toLowerCase();

  if (provider === DEFAULT_STORAGE_PROVIDER) {
    return provider;
  }

  throw new CampaignsConfigError(`Unknown campaigns intro promo storage provider: ${provider}`);
}

function parseAllowedMimeTypes(value) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return unique(parsed.length > 0 ? parsed : DEFAULT_ALLOWED_MIME_TYPES);
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

function createFileFilter(allowedMimeTypes) {
  return (_req, file, cb) => {
    if (!file || !allowedMimeTypes.includes(String(file.mimetype || "").toLowerCase())) {
      return cb(
        new CampaignsConfigError(
          `Unsupported image MIME type '${file?.mimetype || "unknown"}'. Allowed types: ${allowedMimeTypes.join(", ")}`
        ),
        false
      );
    }

    cb(null, true);
  };
}

export function createCampaignsConfig(env = process.env) {
  const provider = normalizeProvider(
    getFirstDefined(env, [
      "CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER",
      "CAMPAIGNS_STORAGE_PROVIDER",
      "STORAGE_PROVIDER"
    ])
  );
  const allowedMimeTypes = parseAllowedMimeTypes(
    getFirstDefined(env, [
      "CAMPAIGNS_INTRO_PROMO_STORAGE_ALLOWED_MIME_TYPES",
      "CAMPAIGNS_ALLOWED_MIME_TYPES"
    ])
  );
  const maxUploadBytes = parsePositiveInteger(
    getFirstDefined(env, [
      "CAMPAIGNS_INTRO_PROMO_STORAGE_MAX_UPLOAD_BYTES",
      "CAMPAIGNS_UPLOAD_MAX_BYTES"
    ]),
    DEFAULT_UPLOAD_MAX_BYTES,
    "CAMPAIGNS_UPLOAD_MAX_BYTES"
  );
  const renderDiskDir =
    getFirstDefined(env, [
      "CAMPAIGNS_INTRO_PROMO_RENDER_DISK_DIR",
      "CAMPAIGNS_RENDER_DISK_DIR"
    ]) || DEFAULT_RENDER_DISK_DIR;
  const publicBaseUrl =
    normalizeBaseUrl(
      getFirstDefined(env, [
        "CAMPAIGNS_INTRO_PROMO_STORAGE_PUBLIC_BASE_URL",
        "CAMPAIGNS_PUBLIC_BASE_URL"
      ])
    ) || "";
  const publicPath = normalizePublicPath(
    getFirstDefined(env, [
      "CAMPAIGNS_INTRO_PROMO_STORAGE_PUBLIC_PATH",
      "CAMPAIGNS_PUBLIC_PATH"
    ])
  );

  return {
    storage: {
      provider,
      allowedMimeTypes,
      maxUploadBytes,
      uploadMaxBytes: maxUploadBytes,
      renderDisk: {
        directory: renderDiskDir,
        mountDir: renderDiskDir,
        publicBaseUrl,
        publicPath
      }
    }
  };
}

export function createCampaignsUploadMiddleware(config) {
  const allowedMimeTypes = config?.storage?.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES;
  const maxUploadBytes = config?.storage?.maxUploadBytes || DEFAULT_UPLOAD_MAX_BYTES;

  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
    fileFilter: createFileFilter(allowedMimeTypes)
  });
}
