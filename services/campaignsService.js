import { formatDateOnly } from "../helpers/dateUtils.js";

const CAMPAIGN_ERROR_CODES = {
  INVALID_ID: "CAMPAIGN_INVALID_ID",
  NOT_FOUND: "CAMPAIGN_NOT_FOUND",
  OVERLAP: "CAMPAIGN_OVERLAP",
  VALIDATION: "CAMPAIGN_VALIDATION_ERROR"
};

function createCampaignError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseBooleanField(value, fieldName, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw createCampaignError(`Invalid boolean value for ${fieldName}`, 400, CAMPAIGN_ERROR_CODES.VALIDATION);
}

function parseDateField(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = formatDateOnly(value);
  if (!normalized) {
    throw createCampaignError(`Invalid date value for ${fieldName}`, 400, CAMPAIGN_ERROR_CODES.VALIDATION);
  }

  return normalized;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeId(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createCampaignError("Campaign id must be a positive integer", 400, CAMPAIGN_ERROR_CODES.INVALID_ID);
  }
  return parsed;
}

function normalizeCampaignInput(input, { existingCampaign = null, requireImage = false } = {}) {
  const title = input.title === undefined ? existingCampaign?.title : String(input.title).trim();
  if (!title) {
    throw createCampaignError("Campaign title is required", 400, CAMPAIGN_ERROR_CODES.VALIDATION);
  }

  const enabled =
    input.enabled === undefined
      ? existingCampaign?.enabled ?? false
      : parseBooleanField(input.enabled, "enabled", false);
  const permanent =
    input.permanent === undefined
      ? existingCampaign?.permanent ?? false
      : parseBooleanField(input.permanent, "permanent", false);

  const startsAt =
    input.startsAt === undefined
      ? existingCampaign ? parseDateField(existingCampaign.startsAt, "startsAt") : null
      : parseDateField(input.startsAt, "startsAt");
  const endsAt =
    input.endsAt === undefined
      ? existingCampaign ? parseDateField(existingCampaign.endsAt, "endsAt") : null
      : parseDateField(input.endsAt, "endsAt");

  const image = input.image ?? existingCampaign?.image ?? null;
  if (requireImage && !image) {
    throw createCampaignError("Campaign image is required", 400, CAMPAIGN_ERROR_CODES.VALIDATION);
  }

  if (!permanent) {
    if (!startsAt || !endsAt) {
      throw createCampaignError(
        "startsAt and endsAt are required for non-permanent campaigns",
        400,
        CAMPAIGN_ERROR_CODES.VALIDATION
      );
    }

    if (startsAt > endsAt) {
      throw createCampaignError(
        "startsAt must be before or equal to endsAt",
        400,
        CAMPAIGN_ERROR_CODES.VALIDATION
      );
    }
  }

  return {
    title,
    enabled,
    permanent,
    startsAt: permanent ? startsAt : startsAt,
    endsAt: permanent ? endsAt : endsAt,
    image
  };
}

function mergeCampaignRecord(existingCampaign, normalizedInput, uploadResult = null, archivedAt = null) {
  const merged = {
    ...existingCampaign,
    title: normalizedInput.title,
    enabled: normalizedInput.enabled,
    permanent: normalizedInput.permanent,
    startsAt: normalizedInput.startsAt,
    endsAt: normalizedInput.endsAt,
    archivedAt: archivedAt ?? existingCampaign?.archivedAt ?? null
  };

  if (uploadResult) {
    merged.storageProvider = uploadResult.storageProvider ?? merged.storageProvider ?? null;
    merged.storageKey = uploadResult.storageKey;
    merged.imageUrl = uploadResult.imageUrl;
    merged.originalName = uploadResult.originalName ?? merged.originalName ?? null;
    merged.mimeType = uploadResult.mimeType ?? merged.mimeType ?? null;
    merged.size = uploadResult.size ?? merged.size ?? null;
  } else if (normalizedInput.image && existingCampaign?.imageUrl) {
    merged.storageProvider = existingCampaign.storageProvider ?? null;
    merged.storageKey = existingCampaign.storageKey ?? null;
    merged.imageUrl = existingCampaign.imageUrl;
    merged.originalName = existingCampaign.originalName ?? null;
    merged.mimeType = existingCampaign.mimeType ?? null;
    merged.size = existingCampaign.size ?? null;
  }

  return merged;
}

function normalizeCampaignResponse(record, referenceDate = new Date()) {
  if (!record) return null;

  const response = {
    id: Number.isFinite(Number(record.id)) ? Number(record.id) : record.id,
    title: record.title,
    enabled: Boolean(record.enabled),
    permanent: Boolean(record.permanent),
    startsAt: parseDateField(record.startsAt ?? record.starts_at, "startsAt"),
    endsAt: parseDateField(record.endsAt ?? record.ends_at, "endsAt"),
    archivedAt: parseTimestamp(record.archivedAt ?? record.archived_at),
    status: deriveCampaignStatus(record, referenceDate),
    imageUrl: record.imageUrl ?? record.image_url ?? null,
    storageProvider: record.storageProvider ?? record.storage_provider ?? null,
    storageKey: record.storageKey ?? record.storage_key ?? null,
    originalName: record.originalName ?? record.original_name ?? null,
    mimeType: record.mimeType ?? record.mime_type ?? null,
    size:
      record.size === undefined || record.size === null ? null : Number(record.size),
    createdAt: parseTimestamp(record.createdAt ?? record.created_at),
    updatedAt: parseTimestamp(record.updatedAt ?? record.updated_at)
  };

  return response;
}

async function deleteUploadedImage(storageProvider, uploadResult) {
  if (uploadResult?.storageKey && typeof storageProvider?.delete === "function") {
    try {
      await storageProvider.delete(uploadResult.storageKey);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function deriveCampaignStatus(campaign, referenceDate = new Date()) {
  if (!campaign) return null;

  if (campaign.archivedAt ?? campaign.archived_at ?? null) {
    return "archived";
  }

  if (!Boolean(campaign.enabled)) {
    return "inactive";
  }

  if (Boolean(campaign.permanent)) {
    return "active";
  }

  const today = formatDateOnly(referenceDate);
  const startsAt = formatDateOnly(campaign.startsAt ?? campaign.starts_at ?? null);
  const endsAt = formatDateOnly(campaign.endsAt ?? campaign.ends_at ?? null);

  if (!startsAt || !endsAt) {
    return "scheduled";
  }

  if (today < startsAt) {
    return "scheduled";
  }

  if (today > endsAt) {
    return "inactive";
  }

  return "active";
}

export function createCampaignsService({
  repository,
  storageProvider,
  storageProviderName = "render_disk",
  clock = () => new Date()
}) {
  async function runInTransaction(work) {
    if (typeof repository.transaction === "function") {
      return repository.transaction(work);
    }
    return work(repository);
  }

  async function ensureNoOverlap(tx, candidate, excludeId = null) {
    if (!candidate.enabled || candidate.archivedAt) {
      return;
    }

    const conflict = await tx.findConflictingEffectiveCampaign({
      excludeId,
      permanent: candidate.permanent,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt
    });

    if (conflict) {
      throw createCampaignError(
        "An effective campaign already exists for the selected date window",
        409,
        CAMPAIGN_ERROR_CODES.OVERLAP
      );
    }
  }

  async function uploadCampaignImage(file) {
    if (!file) return null;

    const uploaded = await storageProvider.upload(file);
    return {
      ...uploaded,
      storageProvider: storageProviderName
    };
  }

  return {
    async getActiveCampaign() {
      const campaign = await repository.findActiveCampaign(clock());
      return normalizeCampaignResponse(campaign, clock());
    },

    async listCampaigns() {
      const campaigns = await repository.listCampaigns?.();
      if (!Array.isArray(campaigns)) {
        return [];
      }
      return campaigns.map((campaign) => normalizeCampaignResponse(campaign, clock()));
    },

    async getCampaignById(id) {
      const campaignId = normalizeId(id);
      const campaign = await repository.findById(campaignId);
      if (!campaign) {
        throw createCampaignError("Campaign not found", 404, CAMPAIGN_ERROR_CODES.NOT_FOUND);
      }
      return normalizeCampaignResponse(campaign, clock());
    },

    async createCampaign(input) {
      const normalized = normalizeCampaignInput(input, {
        requireImage: true
      });

      return runInTransaction(async (tx) => {
        await ensureNoOverlap(tx, normalized);

        const uploaded = await uploadCampaignImage(normalized.image);

        try {
          const created = await tx.createCampaign({
            title: normalized.title,
            enabled: normalized.enabled,
            permanent: normalized.permanent,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            archivedAt: null,
            storageProvider: uploaded?.storageProvider ?? storageProviderName,
            storageKey: uploaded?.storageKey ?? null,
            imageUrl: uploaded?.imageUrl ?? null,
            originalName: uploaded?.originalName ?? null,
            mimeType: uploaded?.mimeType ?? null,
            size: uploaded?.size ?? null
          });

          return normalizeCampaignResponse(created, clock());
        } catch (error) {
          await deleteUploadedImage(storageProvider, uploaded);
          throw error;
        }
      });
    },

    async updateCampaign(id, input) {
      const campaignId = normalizeId(id);
      const existingCampaign = await repository.findById(campaignId);
      if (!existingCampaign) {
        throw createCampaignError("Campaign not found", 404, CAMPAIGN_ERROR_CODES.NOT_FOUND);
      }

      const normalized = normalizeCampaignInput(input, {
        existingCampaign,
        requireImage: false
      });

      return runInTransaction(async (tx) => {
        await ensureNoOverlap(tx, normalized, campaignId);

        const uploaded = normalized.image && normalized.image !== existingCampaign.imageUrl
          ? await uploadCampaignImage(normalized.image)
          : null;

        try {
          const updated = await tx.updateCampaign(campaignId, {
            title: normalized.title,
            enabled: normalized.enabled,
            permanent: normalized.permanent,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            archivedAt: existingCampaign.archivedAt ?? null,
            storageProvider: uploaded?.storageProvider ?? existingCampaign.storageProvider ?? storageProviderName,
            storageKey: uploaded?.storageKey ?? existingCampaign.storageKey ?? null,
            imageUrl: uploaded?.imageUrl ?? existingCampaign.imageUrl ?? null,
            originalName: uploaded?.originalName ?? existingCampaign.originalName ?? null,
            mimeType: uploaded?.mimeType ?? existingCampaign.mimeType ?? null,
            size: uploaded?.size ?? existingCampaign.size ?? null
          });

          if (uploaded && existingCampaign.storageKey && uploaded.storageKey !== existingCampaign.storageKey) {
            await deleteUploadedImage(storageProvider, { storageKey: existingCampaign.storageKey });
          }

          return normalizeCampaignResponse(updated, clock());
        } catch (error) {
          await deleteUploadedImage(storageProvider, uploaded);
          throw error;
        }
      });
    },

    async patchCampaignStatus(id, input) {
      const campaignId = normalizeId(id);
      const existingCampaign = await repository.findById(campaignId);
      if (!existingCampaign) {
        throw createCampaignError("Campaign not found", 404, CAMPAIGN_ERROR_CODES.NOT_FOUND);
      }

      const enabled = parseBooleanField(input?.enabled, "enabled");
      const mergedCampaign = {
        ...existingCampaign,
        enabled
      };

      return runInTransaction(async (tx) => {
        await ensureNoOverlap(tx, mergedCampaign, campaignId);
        const updated = await tx.patchCampaignStatus(campaignId, { enabled });
        return normalizeCampaignResponse(updated, clock());
      });
    },

    async archiveCampaign(id) {
      const campaignId = normalizeId(id);
      const existingCampaign = await repository.findById(campaignId);
      if (!existingCampaign) {
        throw createCampaignError("Campaign not found", 404, CAMPAIGN_ERROR_CODES.NOT_FOUND);
      }

      const archivedAt = new Date(clock()).toISOString();
      return runInTransaction(async (tx) => {
        const archived = await tx.archiveCampaign(campaignId, archivedAt);
        return normalizeCampaignResponse(archived, clock());
      });
    }
  };
}
