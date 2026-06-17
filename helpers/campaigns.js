import { formatDateOnly } from "./dateUtils.js";

export function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function normalizeCampaignDate(value) {
  return formatDateOnly(value);
}

export function deriveCampaignStatus(campaign, now = new Date()) {
  if (!campaign) return "inactive";
  if (campaign.archivedAt) return "archived";
  if (campaign.enabled === false) return "inactive";
  if (campaign.permanent === true) return "active";

  const today = formatDateOnly(now);
  const startsAt = normalizeCampaignDate(campaign.startsAt);
  const endsAt = normalizeCampaignDate(campaign.endsAt);

  if (!startsAt || !endsAt) return "inactive";
  if (today < startsAt) return "scheduled";
  if (today > endsAt) return "inactive";
  return "active";
}

export function toCampaignResponse(campaign, now = new Date()) {
  if (!campaign) return null;
  return {
    id: campaign.id,
    title: campaign.title,
    enabled: campaign.enabled,
    permanent: campaign.permanent,
    startsAt: normalizeCampaignDate(campaign.startsAt),
    endsAt: normalizeCampaignDate(campaign.endsAt),
    archivedAt: campaign.archivedAt || null,
    status: deriveCampaignStatus(campaign, now),
    storageProvider: campaign.storageProvider,
    storageKey: campaign.storageKey,
    imageUrl: campaign.imageUrl,
    originalName: campaign.originalName,
    mimeType: campaign.mimeType,
    size: campaign.size,
    createdAt: campaign.createdAt || null,
    updatedAt: campaign.updatedAt || null
  };
}
