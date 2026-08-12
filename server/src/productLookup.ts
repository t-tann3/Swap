import {
  DEFAULT_PANTRY_CATEGORY,
  type ListingCategory,
} from "./categories.js";
import { log } from "./logger.js";
import { saveUploadFromBuffer } from "./uploads.js";

export type CatalogSource = "spoonacular" | "open_food_facts";

export type CatalogProduct = {
  barcode: string;
  title: string;
  description: string;
  category: ListingCategory;
  brand: string | null;
  quantity: string | null;
  /** Owned Swap upload path when a catalog image was ingested. */
  imageUrl: string | null;
  source: CatalogSource;
};

function normalizeBarcode(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isValidBarcode(code: string): boolean {
  const digits = normalizeBarcode(code);
  return digits.length >= 8 && digits.length <= 14;
}

function spoonacularApiKey(): string | null {
  const key = process.env.SPOONACULAR_API_KEY?.trim();
  return key || null;
}

/** UPC variants to try (leading-zero differences across scanners / databases). */
function barcodeVariants(barcode: string): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  add(barcode);
  if (barcode.length === 13 && barcode.startsWith("0")) {
    add(barcode.slice(1));
  }
  if (barcode.length === 12) {
    add(`0${barcode}`);
  }
  if (barcode.length === 11) {
    add(`0${barcode}`);
    add(`00${barcode}`);
  }
  return out;
}

function pickOffTitle(product: Record<string, unknown>): string {
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

function pickOffDescription(product: Record<string, unknown>): string {
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

function pickOffImageUrl(product: Record<string, unknown>): string | null {
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

function pickSpoonacularImage(body: {
  image?: unknown;
  images?: unknown;
}): string | null {
  const images = Array.isArray(body.images)
    ? body.images.filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
      )
    : [];
  const score = (url: string): number => {
    const m = url.match(/(\d+)x(\d+)/i);
    if (m) return Number(m[1]) * Number(m[2]);
    return 0;
  };
  const preferred = [...images].sort((a, b) => score(b) - score(a))[0];
  if (preferred) return preferred;
  if (typeof body.image === "string" && /^https?:\/\//i.test(body.image)) {
    return body.image;
  }
  return null;
}

function spoonacularDescription(body: {
  brand?: unknown;
  servings?: { size?: unknown; unit?: unknown };
  servingSize?: unknown;
  ingredientList?: unknown;
  aisle?: unknown;
}): string {
  const parts: string[] = [];
  if (typeof body.brand === "string" && body.brand.trim()) {
    parts.push(body.brand.trim());
  }
  const size =
    (typeof body.servings === "object" &&
    body.servings &&
    typeof body.servings.size === "number"
      ? `${body.servings.size}${
          typeof body.servings.unit === "string" ? ` ${body.servings.unit}` : ""
        }`
      : null) ||
    (typeof body.servingSize === "string" ? body.servingSize.trim() : null);
  if (size) parts.push(size);
  if (typeof body.aisle === "string" && body.aisle.trim()) {
    parts.push(body.aisle.trim());
  }
  if (typeof body.ingredientList === "string" && body.ingredientList.trim()) {
    parts.push(body.ingredientList.trim().slice(0, 280));
  }
  return parts.filter(Boolean).join(" · ").slice(0, 500) || "Grocery product.";
}

async function ingestCatalogImage(
  remoteUrl: string,
  barcode: string,
  source: CatalogSource,
): Promise<string | null> {
  try {
    const res = await fetch(remoteUrl, {
      headers: {
        "User-Agent": "SwapPantry/1.0 (barcode listing helper)",
        Accept: "image/*,*/*",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn("catalog_image_http_error", {
        source,
        barcode,
        status: res.status,
        remoteUrl,
      });
      return null;
    }
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    let mime = "image/jpeg";
    if (contentType.includes("png")) mime = "image/png";
    else if (contentType.includes("webp")) mime = "image/webp";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      mime = "image/jpeg";
    } else if (!contentType.startsWith("image/")) {
      if (/\.png(\?|$)/i.test(remoteUrl)) mime = "image/png";
      else if (/\.webp(\?|$)/i.test(remoteUrl)) mime = "image/webp";
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) {
      log.warn("catalog_image_too_small", {
        source,
        barcode,
        bytes: buf.length,
        remoteUrl,
      });
      return null;
    }
    const imageUrl = await saveUploadFromBuffer(buf, mime);
    log.info("catalog_image_ingested", {
      source,
      barcode,
      bytes: buf.length,
      mime,
      imageUrl,
    });
    return imageUrl;
  } catch (err) {
    log.warn("catalog_image_ingest_failed", {
      source,
      barcode,
      remoteUrl,
      errMessage: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function lookupSpoonacular(
  barcode: string,
): Promise<CatalogProduct | null> {
  const apiKey = spoonacularApiKey();
  if (!apiKey) return null;

  const started = Date.now();
  for (const upc of barcodeVariants(barcode)) {
    const url = `https://api.spoonacular.com/food/products/upc/${encodeURIComponent(upc)}`;
    log.info("spoonacular_request", { barcode, upc, url });

    let res: Response;
    try {
      res = await fetch(`${url}?apiKey=${encodeURIComponent(apiKey)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (err) {
      log.error("spoonacular_network_error", {
        barcode,
        upc,
        ms: Date.now() - started,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    if (res.status === 404) {
      log.info("spoonacular_not_found", {
        barcode,
        upc,
        httpStatus: 404,
        ms: Date.now() - started,
      });
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      log.error("spoonacular_auth_error", {
        barcode,
        upc,
        httpStatus: res.status,
        ms: Date.now() - started,
      });
      return null;
    }
    if (res.status === 402) {
      log.error("spoonacular_quota_exceeded", {
        barcode,
        upc,
        httpStatus: 402,
        ms: Date.now() - started,
      });
      return null;
    }
    if (!res.ok) {
      log.warn("spoonacular_http_error", {
        barcode,
        upc,
        httpStatus: res.status,
        ms: Date.now() - started,
      });
      continue;
    }

    const body = (await res.json()) as {
      id?: number;
      title?: string;
      brand?: string;
      aisle?: string;
      image?: string;
      images?: string[];
      ingredientList?: string;
      servingSize?: string;
      servings?: { size?: number; unit?: string };
      status?: number;
      code?: number;
      message?: string;
    };

    // Some misses return 200 with an error payload.
    if (!body.title && (body.status === 404 || body.code === 404)) {
      log.info("spoonacular_not_found", {
        barcode,
        upc,
        ms: Date.now() - started,
      });
      continue;
    }
    if (!body.title?.trim()) {
      log.info("spoonacular_no_product", {
        barcode,
        upc,
        ms: Date.now() - started,
      });
      continue;
    }

    const title = body.title.trim().slice(0, 120);
    const brand =
      typeof body.brand === "string" && body.brand.trim()
        ? body.brand.trim().slice(0, 120)
        : null;
    const quantity =
      typeof body.servingSize === "string" && body.servingSize.trim()
        ? body.servingSize.trim().slice(0, 80)
        : typeof body.servings?.size === "number"
          ? `${body.servings.size}${
              typeof body.servings.unit === "string"
                ? ` ${body.servings.unit}`
                : ""
            }`.slice(0, 80)
          : null;
    const remoteImage = pickSpoonacularImage(body);
    const imageUrl = remoteImage
      ? await ingestCatalogImage(remoteImage, barcode, "spoonacular")
      : null;

    log.info("spoonacular_hit", {
      barcode,
      upc,
      title,
      brand,
      hasRemoteImage: Boolean(remoteImage),
      imageIngested: Boolean(imageUrl),
      ms: Date.now() - started,
    });

    return {
      barcode,
      title,
      description: spoonacularDescription(body),
      category: DEFAULT_PANTRY_CATEGORY,
      brand,
      quantity,
      imageUrl,
      source: "spoonacular",
    };
  }

  return null;
}

async function lookupOpenFoodFacts(
  barcode: string,
): Promise<CatalogProduct | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  const started = Date.now();
  log.info("open_food_facts_request", { barcode, url });

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "SwapPantry/1.0 (https://github.com/swap - pantry stock)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    log.error("open_food_facts_network_error", {
      barcode,
      url,
      ms: Date.now() - started,
      errMessage: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error("lookup_failed"), { status: 502 });
  }

  if (res.status === 404) {
    log.info("open_food_facts_not_found", {
      barcode,
      httpStatus: 404,
      ms: Date.now() - started,
    });
    return null;
  }
  if (!res.ok) {
    log.error("open_food_facts_http_error", {
      barcode,
      httpStatus: res.status,
      ms: Date.now() - started,
    });
    throw Object.assign(new Error("lookup_failed"), { status: 502 });
  }

  const body = (await res.json()) as {
    status?: number;
    product?: Record<string, unknown>;
  };
  if (body.status !== 1 || !body.product) {
    log.info("open_food_facts_no_product", {
      barcode,
      status: body.status ?? null,
      ms: Date.now() - started,
    });
    return null;
  }

  const product = body.product;
  const title = pickOffTitle(product);
  const remoteImage = pickOffImageUrl(product);
  const imageUrl = remoteImage
    ? await ingestCatalogImage(remoteImage, barcode, "open_food_facts")
    : null;

  log.info("open_food_facts_hit", {
    barcode,
    title,
    brand:
      typeof product.brands === "string" ? product.brands.trim() || null : null,
    hasRemoteImage: Boolean(remoteImage),
    imageIngested: Boolean(imageUrl),
    ms: Date.now() - started,
  });

  return {
    barcode,
    title,
    description: pickOffDescription(product),
    category: DEFAULT_PANTRY_CATEGORY,
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

/**
 * Look up a grocery barcode. Prefers Spoonacular (cleaner pack shots) when
 * SPOONACULAR_API_KEY is set, then falls back to Open Food Facts.
 */
export async function lookupBarcodeProduct(
  rawBarcode: string,
): Promise<CatalogProduct | null> {
  const barcode = normalizeBarcode(rawBarcode);
  if (!isValidBarcode(barcode)) {
    throw Object.assign(new Error("invalid_barcode"), { status: 400 });
  }

  const primary = await lookupSpoonacular(barcode);
  if (primary) return primary;

  if (spoonacularApiKey()) {
    log.info("catalog_fallback_open_food_facts", { barcode });
  }
  return lookupOpenFoodFacts(barcode);
}
