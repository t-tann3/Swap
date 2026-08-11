export const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
    /\/$/,
    "",
  );

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function fileToBase64(file: File): Promise<{
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}> {
  const mime =
    file.type === "image/png" || file.type === "image/webp"
      ? file.type
      : "image/jpeg";
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return { imageBase64: btoa(binary), mimeType: mime };
}
