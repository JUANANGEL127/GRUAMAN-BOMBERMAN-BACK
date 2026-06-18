# Campaign Images Storage Provider Migration Guide

## Purpose

This document explains how the current campaign image storage layer works and how to add a new provider later without changing the existing frontend contract or the HTTP endpoints.

## Current Contract

The campaigns feature is intentionally built around a storage abstraction. Controllers and services must never depend on a physical vendor such as Render Disk, S3, R2, MinIO, or Cloudinary.

Current provider interface:

```js
{
  upload(file) -> { storageKey, imageUrl, originalName, mimeType, size },
  delete(storageKey) -> void,
  getUrl(storageKey) -> string
}
```

### Files involved

- `config/campaignsConfig.js` — reads env/config and builds the storage config
- `storage/storageProvider.js` — factory that selects the provider implementation
- `storage/renderDiskProvider.js` — current Render Persistent Disk implementation
- `services/campaignsService.js` — business logic that calls the storage abstraction only
- `repositories/campaignsRepository.js` — stores metadata only, never binary content
- `index.js` — mounts the public static route used by the current Render Disk setup

## What the database stores

The `campaigns` table stores metadata only:

- `storage_provider`
- `storage_key`
- `image_url`
- `original_name`
- `mime_type`
- `size`

This is important because it allows future provider migration without changing the business contract.

## Current Render Disk behavior

Today the implementation uses `render_disk`:

- writes files to a mounted directory
- serves those files publicly through the backend static route
- returns `imageUrl` ready for React

Default config values currently used:

- provider: `render_disk`
- mount directory: `/opt/render/project/src/storage/campaigns`
- public path: `/media/campaigns`

## Rule for future providers

When adding a new provider, keep these rules:

1. Do not change the admin endpoints
2. Do not change `GET /campaigns/active`
3. Do not change the response shape expected by React
4. Do not store binaries in PostgreSQL
5. Do not leak vendor-specific code into controllers or services
6. Do not remove `StorageProvider`; extend it

## How to add a new provider manually

### Step 1: Create the provider file

Create a new file under `storage/`, for example:

- `storage/r2Provider.js`
- `storage/s3Provider.js`
- `storage/minioProvider.js`

That file must export a factory that returns an object with the same interface:

```js
export function createR2Provider(options = {}) {
  return {
    async upload(file) {
      // upload bytes to provider
      return {
        storageKey: "campaigns/...",
        imageUrl: "https://cdn.example.com/...",
        originalName: file.originalname || null,
        mimeType: file.mimetype || null,
        size: file.size ?? null
      };
    },

    async delete(storageKey) {
      // delete object from provider
    },

    getUrl(storageKey) {
      return `https://cdn.example.com/${encodeURIComponent(storageKey)}`;
    }
  };
}
```

### Step 2: Add env parsing in `config/campaignsConfig.js`

Extend the config builder so it understands the new provider.

Example for R2-like config:

```js
storage: {
  provider,
  allowedMimeTypes,
  maxUploadBytes,
  r2: {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl
  }
}
```

Recommended env naming pattern:

- `CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER=r2`
- `CAMPAIGNS_INTRO_PROMO_R2_BUCKET=...`
- `CAMPAIGNS_INTRO_PROMO_R2_PUBLIC_BASE_URL=...`
- `CAMPAIGNS_INTRO_PROMO_R2_ACCESS_KEY_ID=...`
- `CAMPAIGNS_INTRO_PROMO_R2_SECRET_ACCESS_KEY=...`

Use the same pattern if the provider is `s3` or another backend.

### Step 3: Register the provider in `storage/storageProvider.js`

Add a new branch in the provider factory.

Example:

```js
import { createR2Provider } from "./r2Provider.js";

export function createStorageProvider(config) {
  const storageConfig = config?.storage;
  const provider = String(storageConfig?.provider || "").trim();

  if (provider === "render_disk") {
    // current implementation
  }

  if (provider === "r2") {
    return createR2Provider({
      bucket: storageConfig.r2.bucket,
      publicBaseUrl: storageConfig.r2.publicBaseUrl,
      accessKeyId: storageConfig.r2.accessKeyId,
      secretAccessKey: storageConfig.r2.secretAccessKey
    });
  }

  throw new StorageProviderError(`Unknown campaigns intro promo storage provider: ${provider || "unknown"}`);
}
```

### Step 4: Keep the service untouched if possible

The ideal migration means `services/campaignsService.js` should not need a structural change.

Why? Because the service already works against:

- `upload(file)`
- `delete(storageKey)`
- `getUrl(storageKey)`

If you need to change the service to support a new provider, that is usually a smell that the provider contract is leaking infrastructure details.

### Step 5: Decide how `imageUrl` will be built

There are two valid future models:

#### Option A — Provider returns direct CDN URL
Example:

```text
https://cdn.example.com/campaigns/uuid.webp
```

Pros:
- no backend static serving needed
- simpler delivery path

Cons:
- CDN/public URL becomes provider-owned

#### Option B — Provider returns backend-owned URL
Example:

```text
https://api.example.com/media/campaigns/uuid.webp
```

Pros:
- contract remains fully backend-owned

Cons:
- may require a proxy/download route instead of direct object URL

For R2/S3, Option A is usually simpler and cheaper.

### Step 6: Preserve stored metadata contract

The new provider must still persist:

- `storageProvider`
- `storageKey`
- `imageUrl`
- `originalName`
- `mimeType`
- `size`

Do not replace those columns with provider-specific fields in business logic.

If you need more provider-specific metadata, prefer one of these strategies:

1. derive it again from env/config
2. encode what is necessary into `storageKey`
3. add a separate optional metadata column later only if it becomes necessary

## Example migration to R2

### 1. Add provider file
- `storage/r2Provider.js`

### 2. Add config support
- read `CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER=r2`
- read bucket/credentials/public URL envs

### 3. Extend factory
- `storage/storageProvider.js`

### 4. Change env in Render

```env
CAMPAIGNS_INTRO_PROMO_STORAGE_PROVIDER=r2
CAMPAIGNS_INTRO_PROMO_R2_BUCKET=campaigns
CAMPAIGNS_INTRO_PROMO_R2_PUBLIC_BASE_URL=https://cdn.example.com
CAMPAIGNS_INTRO_PROMO_R2_ACCESS_KEY_ID=...
CAMPAIGNS_INTRO_PROMO_R2_SECRET_ACCESS_KEY=...
```

### 5. Keep the endpoints the same
No frontend endpoint change required.

## Static route note

The current static route mounted in `index.js` is only necessary for `render_disk` because files live on the backend filesystem.

When migrating to an object-storage provider such as R2 or S3, you have two choices:

1. keep the static route unused and return CDN/object URLs from the provider
2. replace the static route later with a backend proxy route if you want the backend to own delivery

For a simple CDN/object storage migration, returning provider-backed public URLs is enough.

## Manual test checklist for a future provider

After adding the provider manually, verify:

1. app starts with the new `STORAGE_PROVIDER`
2. invalid provider still fails deterministically
3. admin create campaign uploads image successfully
4. admin update campaign replaces image successfully
5. old image deletion still works when replacing assets
6. `GET /campaigns/active` returns a valid `imageUrl`
7. image renders in React without frontend changes
8. overlap logic still works unchanged
9. database still stores metadata only
10. no binary data is written to PostgreSQL

## Common mistakes to avoid

- writing vendor SDK calls directly inside `campaignsService`
- changing request/response contracts to match a provider
- storing binary image payloads in PostgreSQL
- hardcoding a provider in controllers or routes
- making the frontend decide which storage backend is active
- adding provider-specific behavior in React

## Recommended future implementation order

1. add provider file
2. add config parsing
3. register provider in factory
4. add tests for config + provider factory
5. add provider-specific upload/delete tests
6. verify existing campaign service tests still pass
7. deploy behind env switch only

## Bottom line

If the storage abstraction remains clean, a future migration should be mostly:

- one new provider file
- one config extension
- one factory branch
- zero frontend endpoint changes
- zero campaign business-rule changes
