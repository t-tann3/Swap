import type { ListingCategory } from "./categories.js";
import { saveUploadFromBuffer } from "./uploads.js";

export type CatalogProduct = {
  barcode: string;
  title: string;
  description: string;
  category: ListingCategory;
  brand: string | null;
  quantity: string | null;
  /** Owned Swap upload path when a catalog image was ingested. */
  imageUrl: string | null;
  source: "open_food_facts";
};

function normalizeBarcode(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isValidBarcode(code: string): boolean {
  const digits = normalizeBarcode(code);
  return digits.length >= 8 && digits.length <= 14;
}

function pickTitle(product: Record<string, unknown>): string {
  const candidates = [
    product.product_name,
    product.product_name_en,
    product.generic_name,
    product.generic_name_en,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 120);
  }
  const brands = typeof product.brands === "string" ? product.brands.trim() : "";
  if (brands) return brands.slice(0, 120);
  return "Pantry item";
}

function pickDescription(product: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof product.brands === "string" && product.brands.trim()) {
    parts.push(product.brands.trim());
  }
  if (typeof product.quantity === "string" && product.quantity.trim()) {
    parts.push(product.quantity.trim());
  }
  const cats =
    typeof product.categories === "string" ? product.categories.trim() : "";
  if (cats) {
    const first = cats.split(",")[0]?.trim();
    if (first) parts.push(first);
  }
  const ingredients =
    typeof product.ingredients_text_en === "string"
      ? product.ingredients_text_en.trim()
      : typeof product.ingredients_text === "string"
        ? product.ingredients_text.trim()
        : "";
  if (ingredients) {
    parts.push(ingredients.slice(0, 280));
  }
  const text = parts.filter(Boolean).join(" · ").trim();
  return text.slice(0, 500) || "Scanned pantry food item.";
}

function pickImageUrl(product: Record<string, unknown>): string | null {
  const keys = [
    "image_front_url",
    "image_url",
    "image_front_small_url",
    "image_small_url",
  ];
  for (const key of keys) {
    const v = product[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

async function ingestCatalogImage(remoteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(remoteUrl, {
      headers: {
        "User-Agent": "SwapPantry/1.0 (barcode listing helper)",
        Accept: "image/*,*/*",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    let mime = "image/jpeg";
    if (contentType.includes("png")) mime = "image/png";
    else if (contentType.includes("webp")) mime = "image/webp";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      mime = "image/jpeg";
    } else if (!contentType.startsWith("image/")) {
      // Some CDNs omit type; assume jpeg from URL extension.
      if (/\.png(\?|$)/i.test(remoteUrl)) mime = "image/png";
      else if (/\.webp(\?|$)/i.test(remoteUrl)) mime = "image/webp";
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) return null;
    return await saveUploadFromBuffer(buf, mime);
  } catch {
    return null;
  }
}

/**
 * Look up a grocery barcode via Open Food Facts and optionally ingest a
 * catalog front image into Swap uploads.
 */
export async function lookupBarcodeProduct(
  rawBarcode: string,
): Promise<CatalogProduct | null> {
  const barcode = normalizeBarcode(rawBarcode);
  if (!isValidBarcode(barcode)) {
    throw Object.assign(new Error("invalid_barcode"), { status: 400 });
  }

  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SwapPantry/1.0 (https://github.com/swap — pantry stock)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error("lookup_failed"), { status: 502 });
  }

  const body = (await res.json()) as {
    status?: number;
    product?: Record<string, unknown>;
  };
  if (body.status !== 1 || !body.product) return null;

  const product = body.product;
  const remoteImage = pickImageUrl(product);
  const imageUrl = remoteImage ? await ingestCatalogImage(remoteImage) : null;

  return {
    barcode,
    title: pickTitle(product),
    description: pickDescription(product),
    category: "Food",
    brand:
      typeof product.brands === "string" && product.brands.trim()
        ? product.brands.trim().slice(0, 120)
        : null,
    quantity:
      typeof product.quantity === "string" && product.quantity.trim()
        ? product.quantity.trim().slice(0, 80)
        : null,
    imageUrl,
    source: "open_food_facts",
  };
}
