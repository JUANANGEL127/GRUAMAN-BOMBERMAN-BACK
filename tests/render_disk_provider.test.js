import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { createRenderDiskProvider } from "../storage/renderDiskProvider.js";

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), "campaigns-intro-promo-"));
}

test("upload persists bytes to the mounted directory and returns a public imageUrl", async () => {
  const directory = await createTempDir();
  const provider = createRenderDiskProvider({
    directory,
    publicBaseUrl: "https://cdn.example.test",
    publicPath: "/media/campaigns",
    allowedMimeTypes: ["image/png"],
    maxUploadBytes: 1024
  });

  try {
    const result = await provider.upload({
      originalname: "banner.png",
      mimetype: "image/png",
      size: 11,
      buffer: Buffer.from("hello world")
    });

    const savedBytes = await readFile(path.join(directory, result.storageKey));

    assert.ok(result.storageKey.length > 0);
    assert.equal(result.imageUrl, provider.getUrl(result.storageKey));
    assert.equal(
      result.imageUrl,
      `https://cdn.example.test/media/campaigns/${encodeURIComponent(result.storageKey)}`
    );
    assert.equal(savedBytes.toString("utf8"), "hello world");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upload rejects unsupported mime types and oversized files", async () => {
  const directory = await createTempDir();
  const provider = createRenderDiskProvider({
    directory,
    allowedMimeTypes: ["image/png"],
    maxUploadBytes: 5
  });

  try {
    await assert.rejects(
      () =>
        provider.upload({
          originalname: "banner.jpg",
          mimetype: "image/jpeg",
          size: 4,
          buffer: Buffer.from("abcd")
        }),
      (error) => error?.message === "Unsupported mime type: image/jpeg"
    );

    await assert.rejects(
      () =>
        provider.upload({
          originalname: "banner.png",
          mimetype: "image/png",
          size: 6,
          buffer: Buffer.from("abcdef")
        }),
      (error) => error?.message === "File exceeds the configured upload limit"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("delete removes stored files and is safe when the file is already missing", async () => {
  const directory = await createTempDir();
  const provider = createRenderDiskProvider({
    directory,
    allowedMimeTypes: ["image/png"],
    maxUploadBytes: 1024
  });

  try {
    const { storageKey } = await provider.upload({
      originalname: "banner.png",
      mimetype: "image/png",
      size: 3,
      buffer: Buffer.from("bye")
    });

    await provider.delete(storageKey);

    await assert.rejects(() => stat(path.join(directory, storageKey)));

    await assert.doesNotReject(() => provider.delete(storageKey));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
