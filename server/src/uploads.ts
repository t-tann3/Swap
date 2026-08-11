import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newId } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, "..", "data", "uploads");

const MAX_BYTES = Math.floor(1.5 * 1024 * 1024);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Paths we accept back on listings / drop-off (local upload URLs only). */
export function isOwnedUploadUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return /^\/uploads\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/.test(url);
}

export async function ensureUploadsDir(): Promise<void> {
  await mkdir(uploadsDir, { recursive: true });
}

/**
 * Decode a base64 image payload and write it under data/uploads.
 * Returns a public path like `/uploads/img_….jpg`.
 */
export async function saveUploadFromBase64(input: {
  imageBase64: string;
  mimeType: string;
}): Promise<string> {
  const mime = input.mimeType.trim().toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw Object.assign(new Error("unsupported_type"), { status: 400 });
  }

  let raw = input.imageBase64.trim();
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (dataUrl) {
    const embeddedMime = dataUrl[1]!.toLowerCase();
    if (!MIME_TO_EXT[embeddedMime]) {
      throw Object.assign(new Error("unsupported_type"), { status: 400 });
    }
    raw = dataUrl[2]!;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw Object.assign(new Error("invalid_image"), { status: 400 });
  }

  if (!buffer.length) {
    throw Object.assign(new Error("invalid_image"), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error("image_too_large"), { status: 400 });
  }

  return saveUploadFromBuffer(buffer, mime);
}

/** Persist a raw image buffer as an owned `/uploads/…` path. */
export async function saveUploadFromBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const mime = mimeType.trim().toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw Object.assign(new Error("unsupported_type"), { status: 400 });
  }
  if (!buffer.length) {
    throw Object.assign(new Error("invalid_image"), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error("image_too_large"), { status: 400 });
  }
  await ensureUploadsDir();
  const filename = `${newId("img")}.${ext}`;
  await writeFile(path.join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}
