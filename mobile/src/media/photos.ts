import { launchCamera, launchImageLibrary } from "react-native-image-picker";

import { apiRequest } from "../api/client";
import { API_BASE_URL } from "../api/config";

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function uploadImageBase64(
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const res = await apiRequest<{ url: string }>("/api/uploads", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  return res.url;
}

type PickSource = "camera" | "library";

/**
 * Capture or pick a photo, compress, upload to Swap, return `/uploads/…` URL.
 * Returns null if the user cancels.
 */
export async function pickAndUploadPhoto(
  source: PickSource = "camera",
): Promise<string | null> {
  const launcher = source === "camera" ? launchCamera : launchImageLibrary;
  const result = await launcher({
    mediaType: "photo",
    cameraType: "back",
    quality: 0.7,
    maxWidth: 1600,
    maxHeight: 1600,
    includeBase64: true,
    saveToPhotos: false,
  });

  if (result.didCancel) return null;
  if (result.errorCode) {
    throw new Error(result.errorMessage ?? `Photo error (${result.errorCode})`);
  }

  const asset = result.assets?.[0];
  if (!asset?.base64) {
    throw new Error("No photo data returned.");
  }

  const mimeType =
    asset.type === "image/png" || asset.type === "image/webp"
      ? asset.type
      : "image/jpeg";

  return uploadImageBase64(asset.base64, mimeType);
}
