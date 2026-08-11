import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { saveUploadFromBase64 } from "../uploads.js";

export const uploadsRouter = Router();

const bodySchema = z.object({
  imageBase64: z.string().min(1).max(3_000_000),
  mimeType: z
    .enum(["image/jpeg", "image/jpg", "image/png", "image/webp"])
    .default("image/jpeg"),
});

uploadsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_body",
      message: "Send imageBase64 and mimeType (jpeg, png, or webp).",
    });
    return;
  }

  try {
    const url = await saveUploadFromBase64(parsed.data);
    res.status(201).json({ url });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "unsupported_type"
          ? "Only JPEG, PNG, and WebP images are supported."
          : code === "image_too_large"
            ? "Image must be 1.5MB or smaller."
            : code === "invalid_image"
              ? "Could not decode that image."
              : "Upload failed.",
    });
  }
});
