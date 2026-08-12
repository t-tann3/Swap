import { getDb, mutateDb, newId } from "./db.js";
import type {
  Basket,
  Listing,
  Order,
  PantrySettings,
  Profile,
  StockAdjustment,
} from "./types.js";

export const DEFAULT_PATRON_CAP = 5;
export const DEFAULT_BASKET_HOLD_TTL_MINUTES = 120;
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export function defaultPantrySettings(ts = new Date().toISOString()): PantrySettings {
  return {
    id: "default",
    enabled: false,
    defaultPatronCap: DEFAULT_PATRON_CAP,
    hardReserveEnabled: true,
    basketHoldTtlMinutes: DEFAULT_BASKET_HOLD_TTL_MINUTES,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    updatedAt: ts,
  };
}

export function getPantrySettings(): PantrySettings {
  const raw = getDb().pantrySettings ?? defaultPantrySettings();
  return {
    ...defaultPantrySettings(raw.updatedAt),
    ...raw,
    basketHoldTtlMinutes:
      raw.basketHoldTtlMinutes ?? DEFAULT_BASKET_HOLD_TTL_MINUTES,
    lowStockThreshold: raw.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  };
}

export function isPantryMode(): boolean {
  return getPantrySettings().enabled;
}

/** Commerce charges are off when pantry mode is on (even if Stripe keys exist). */
export function commerceEnabled(): boolean {
  // Lazy import avoided — callers that need Stripe still check paymentsEnabled().
  return !isPantryMode();
}

export function resolvePatronCap(profile: Profile | undefined | null): number {
  const settings = getPantrySettings();
  if (profile?.patronCap != null && profile.patronCap > 0) {
    return Math.floor(profile.patronCap);
  }
  return Math.max(1, Math.floor(settings.defaultPatronCap || DEFAULT_PATRON_CAP));
}

export function isPatronBlocked(profile: Profile | undefined | null): boolean {
  return Boolean(profile?.pantryBlocked);
}

export function basketUnitCount(basket: Basket | undefined | null): number {
  if (!basket) return 0;
  return basket.items.reduce((sum, i) => sum + Math.max(0, i.quantity), 0);
}

/** Normalize legacy single-listing orders to a line list. */
export function orderLineItems(order: {
  listingId: string;
  items?: { listingId: string; quantity: number; title?: string }[] | null;
}): { listingId: string; quantity: number; title: string }[] {
  if (order.items && order.items.length > 0) {
    return order.items.map(i => ({
      listingId: i.listingId,
      quantity: Math.max(1, Math.floor(i.quantity)),
      title: i.title?.trim() || "Item",
    }));
  }
  return [{ listingId: order.listingId, quantity: 1, title: "Item" }];
}

export function orderUnitCount(order: {
  listingId: string;
  items?: { listingId: string; quantity: number; title?: string }[] | null;
}): number {
  return orderLineItems(order).reduce((sum, i) => sum + i.quantity, 0);
}

const OPEN_ORDER_STATUSES: Order["status"][] = [
  "pending_accept",
  "accepted",
  "ready_for_pickup",
];

/** Units already claimed via open orders (counts toward the patron cap). */
export function openOrderUnitCount(userId: string): number {
  return getDb()
    .orders.filter(
      o =>
        o.buyerUserId === userId && OPEN_ORDER_STATUSES.includes(o.status),
    )
    .reduce((sum, o) => sum + orderUnitCount(o), 0);
}

export function getPatronAllocation(userId: string): {
  cap: number;
  basketUnits: number;
  openOrderUnits: number;
  used: number;
  remaining: number;
} {
  const profile = getDb().profiles.find(p => p.userId === userId);
  const basket = getDb().baskets.find(b => b.userId === userId);
  const cap = resolvePatronCap(profile);
  const basketUnits = basketUnitCount(basket);
  const openOrderUnits = openOrderUnitCount(userId);
  const used = basketUnits + openOrderUnits;
  return {
    cap,
    basketUnits,
    openOrderUnits,
    used,
    remaining: Math.max(0, cap - used),
  };
}

export function ensureBasket(userId: string): Basket {
  const existing = getDb().baskets.find(b => b.userId === userId);
  if (existing) return existing;
  const basket: Basket = {
    userId,
    items: [],
    updatedAt: new Date().toISOString(),
  };
  return basket;
}

export function listingAvailableUnits(listing: Listing): number {
  if (listing.status !== "available") return 0;
  const qty = listing.stockQty ?? 1;
  return Math.max(0, qty);
}

/** Units hard-held in open baskets for this listing. */
export function listingReservedInBaskets(listingId: string): number {
  return getDb().baskets.reduce((sum, basket) => {
    const line = basket.items.find(i => i.listingId === listingId);
    return sum + (line ? Math.max(0, line.quantity) : 0);
  }, 0);
}

/** Per-item basket cap for a listing (default 1). */
export function listingMaxPerOrder(listing: Listing): number {
  const raw = listing.maxPerOrder;
  if (raw == null || !Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(50, Math.floor(raw));
}

/**
 * Hard ceiling for how many of this listing may be in a basket line.
 * `heldInBasket` counts units already reserved for this patron's line so the
 * limit stays correct after hard-reserve (free stock + their hold).
 */
export function listingBasketLimit(
  listing: Listing,
  heldInBasket = 0,
): number {
  const free = listingAvailableUnits(listing);
  const held = Math.max(0, Math.floor(heldInBasket));
  return Math.min(listingMaxPerOrder(listing), free + held);
}

/**
 * Pull units out of free stock (basket hold or checkout). When stock hits 0,
 * mark reserved so others cannot browse/take them.
 */
export function consumeListingUnits(
  listing: Listing,
  qty: number,
  ts = new Date().toISOString(),
): void {
  const n = Math.max(0, Math.floor(qty));
  if (n < 1) return;
  if (listing.status === "cancelled" || listing.status === "draft") {
    throw new Error("listing_not_stockable");
  }
  const free = listingAvailableUnits(listing);
  if (free < n) {
    throw new Error("insufficient_stock");
  }
  listing.stockQty = Math.max(0, (listing.stockQty ?? 0) - n);
  listing.updatedAt = ts;
  if (listing.stockQty <= 0) {
    listing.status = "out_of_stock";
  }
}

/**
 * Return units to free stock (basket remove, cancel, refund). Always restores
 * even when the listing stayed `available` (multi-unit pantry).
 */
export function releaseListingUnits(
  listing: Listing,
  qty: number,
  ts = new Date().toISOString(),
): void {
  const n = Math.max(0, Math.floor(qty));
  if (n < 1) return;
  if (listing.status === "cancelled" || listing.status === "draft") return;
  listing.stockQty = Math.max(0, (listing.stockQty ?? 0) + n);
  listing.status = "available";
  listing.updatedAt = ts;
}

/**
 * After a unit order completes: stock was already consumed at reserve/checkout.
 * Keep listing browsable when other units remain; when depleted, pantry uses
 * out_of_stock (marketplace uses sold).
 */
export function markListingUnitCompleted(
  listing: Listing,
  ts = new Date().toISOString(),
): void {
  if (listing.status === "cancelled" || listing.status === "draft") return;
  if ((listing.stockQty ?? 0) > 0) {
    listing.status = "available";
  } else if (isPantryMode()) {
    listing.status = "out_of_stock";
  } else {
    listing.status = "sold";
  }
  listing.updatedAt = ts;
}

/** After seller edits stock, sync available vs out_of_stock. */
export function syncListingStockStatus(
  listing: Listing,
  ts = new Date().toISOString(),
): void {
  if (
    listing.status === "cancelled" ||
    listing.status === "draft" ||
    listing.status === "sold" ||
    listing.status === "reserved"
  ) {
    return;
  }
  if ((listing.stockQty ?? 0) > 0) {
    listing.status = "available";
  } else {
    listing.status = "out_of_stock";
  }
  listing.updatedAt = ts;
}

export function inventoryRowForListing(listing: Listing) {
  const available = Math.max(0, listing.stockQty ?? 0);
  const reserved = listingReservedInBaskets(listing.id);
  const threshold = getPantrySettings().lowStockThreshold;
  return {
    listing,
    available,
    reserved,
    total: available + reserved,
    lowStock: available > 0 && available <= threshold,
    outOfStock: available <= 0 || listing.status === "out_of_stock",
  };
}

export function sellerInventory(sellerUserId: string) {
  return getDb()
    .listings.filter(
      l =>
        l.sellerUserId === sellerUserId &&
        l.status !== "cancelled" &&
        l.status !== "draft",
    )
    .map(inventoryRowForListing)
    .sort((a, b) => {
      if (a.outOfStock !== b.outOfStock) return a.outOfStock ? 1 : -1;
      if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
      return a.listing.title.localeCompare(b.listing.title);
    });
}

/** Apply a signed stock delta. Optional reason is kept on the ledger when provided. */
export function applyStockAdjustment(
  listing: Listing,
  sellerUserId: string,
  delta: number,
  reason = "",
  ts = new Date().toISOString(),
  actorUserId: string | null = null,
): StockAdjustment {
  const n = Math.trunc(delta);
  if (n === 0) throw new Error("invalid_delta");
  const trimmed = reason.trim().slice(0, 200);
  if (
    listing.status === "cancelled" ||
    listing.status === "draft" ||
    listing.status === "sold"
  ) {
    throw new Error("listing_not_stockable");
  }
  const previousQty = Math.max(0, listing.stockQty ?? 0);
  const nextQty = Math.max(0, previousQty + n);
  listing.stockQty = nextQty;
  syncListingStockStatus(listing, ts);
  return {
    id: newId("stk"),
    listingId: listing.id,
    sellerUserId,
    actorUserId: actorUserId ?? sellerUserId,
    delta: n,
    reason: trimmed,
    previousQty,
    nextQty,
    createdAt: ts,
  };
}

/**
 * Release hard holds for baskets idle longer than TTL.
 * Uses basket.updatedAt as last activity.
 */
export async function sweepAbandonedBaskets(): Promise<{
  checked: number;
  cleared: number;
  unitsReleased: number;
}> {
  const settings = getPantrySettings();
  const ttlMin = settings.basketHoldTtlMinutes;
  if (!settings.enabled || !ttlMin || ttlMin < 1) {
    return { checked: 0, cleared: 0, unitsReleased: 0 };
  }

  const cutoff = Date.now() - ttlMin * 60_000;
  let checked = 0;
  let cleared = 0;
  let unitsReleased = 0;

  await mutateDb(db => {
    const ts = new Date().toISOString();
    for (const basket of db.baskets) {
      if (!basket.items.length) continue;
      checked += 1;
      const updated = Date.parse(basket.updatedAt);
      if (!Number.isFinite(updated) || updated > cutoff) continue;
      for (const item of basket.items) {
        const listing = db.listings.find(l => l.id === item.listingId);
        if (listing) {
          releaseListingUnits(listing, item.quantity, ts);
          unitsReleased += item.quantity;
        }
      }
      basket.items = [];
      basket.updatedAt = ts;
      cleared += 1;
    }
  });

  return { checked, cleared, unitsReleased };
}

export function buildPantryReport() {
  const db = getDb();
  const settings = getPantrySettings();
  const now = Date.now();

  const completed = db.orders.filter(o => o.status === "completed");
  const unitsOut = completed
    .filter(o => o.completedReason !== "no_show")
    .reduce((sum, o) => sum + orderUnitCount(o), 0);
  const noShows = completed.filter(o => o.completedReason === "no_show").length;
  const stockOuts = db.listings.filter(
    l =>
      l.status === "out_of_stock" ||
      ((l.stockQty ?? 0) <= 0 &&
        l.status !== "cancelled" &&
        l.status !== "draft" &&
        l.status !== "sold"),
  ).length;
  const openOrders = db.orders.filter(o =>
    OPEN_ORDER_STATUSES.includes(o.status),
  );
  const overdueDropOffs = openOrders.filter(
    o =>
      o.status === "accepted" &&
      o.sellerDropOffDeadlineAt &&
      Date.parse(o.sellerDropOffDeadlineAt) < now,
  ).length;
  const lowStock = db.listings.filter(l => {
    if (l.status === "cancelled" || l.status === "draft" || l.status === "sold") {
      return false;
    }
    const available = Math.max(0, l.stockQty ?? 0);
    return available > 0 && available <= settings.lowStockThreshold;
  }).length;
  const activeBaskets = db.baskets.filter(b => b.items.length > 0).length;
  const reservedUnits = db.baskets.reduce(
    (sum, b) => sum + basketUnitCount(b),
    0,
  );

  const byDay = new Map<string, { unitsOut: number; noShows: number; orders: number }>();
  for (const o of completed) {
    const day = (o.completedAt ?? o.updatedAt).slice(0, 10);
    const row = byDay.get(day) ?? { unitsOut: 0, noShows: 0, orders: 0 };
    row.orders += 1;
    if (o.completedReason === "no_show") row.noShows += 1;
    else row.unitsOut += orderUnitCount(o);
    byDay.set(day, row);
  }

  return {
    generatedAt: new Date().toISOString(),
    pantryMode: settings.enabled,
    summary: {
      unitsOut,
      noShows,
      stockOuts,
      lowStock,
      openOrders: openOrders.length,
      overdueDropOffs,
      activeBaskets,
      reservedUnits,
      completedOrders: completed.length,
    },
    daily: [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 30)
      .map(([date, row]) => ({ date, ...row })),
  };
}

export function pantryReportToCsv(
  report: ReturnType<typeof buildPantryReport>,
): string {
  const lines = [
    "metric,value",
    `generatedAt,${report.generatedAt}`,
    `pantryMode,${report.pantryMode}`,
    ...Object.entries(report.summary).map(([k, v]) => `${k},${v}`),
    "",
    "date,unitsOut,noShows,orders",
    ...report.daily.map(
      d => `${d.date},${d.unitsOut},${d.noShows},${d.orders}`,
    ),
  ];
  return lines.join("\n");
}

export type FulfillmentBucket =
  | "needs_accept"
  | "needs_drop_off"
  | "overdue"
  | "ready";

export function fulfillmentBucket(
  order: Order,
  now = Date.now(),
): FulfillmentBucket | null {
  if (order.status === "pending_accept") return "needs_accept";
  if (order.status === "ready_for_pickup") return "ready";
  if (order.status === "accepted") {
    if (
      order.sellerDropOffDeadlineAt &&
      Date.parse(order.sellerDropOffDeadlineAt) < now
    ) {
      return "overdue";
    }
    return "needs_drop_off";
  }
  return null;
}

export function fulfillmentSortKey(order: Order, now = Date.now()): number {
  const bucket = fulfillmentBucket(order, now);
  const rank =
    bucket === "overdue"
      ? 0
      : bucket === "needs_accept"
        ? 1
        : bucket === "needs_drop_off"
          ? 2
          : bucket === "ready"
            ? 3
            : 9;
  return rank;
}

export async function updatePantrySettings(
  patch: Partial<
    Pick<
      PantrySettings,
      | "enabled"
      | "defaultPatronCap"
      | "basketHoldTtlMinutes"
      | "lowStockThreshold"
    >
  >,
): Promise<PantrySettings> {
  let next: PantrySettings = getPantrySettings();
  await mutateDb(db => {
    const current = {
      ...defaultPantrySettings(),
      ...(db.pantrySettings ?? {}),
    };
    next = {
      id: "default",
      enabled:
        patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
      defaultPatronCap:
        patch.defaultPatronCap !== undefined
          ? Math.max(1, Math.min(50, Math.floor(patch.defaultPatronCap)))
          : current.defaultPatronCap,
      hardReserveEnabled: current.hardReserveEnabled ?? true,
      basketHoldTtlMinutes:
        patch.basketHoldTtlMinutes !== undefined
          ? Math.max(0, Math.min(24 * 60, Math.floor(patch.basketHoldTtlMinutes)))
          : (current.basketHoldTtlMinutes ?? DEFAULT_BASKET_HOLD_TTL_MINUTES),
      lowStockThreshold:
        patch.lowStockThreshold !== undefined
          ? Math.max(0, Math.min(100, Math.floor(patch.lowStockThreshold)))
          : (current.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD),
      updatedAt: new Date().toISOString(),
    };
    db.pantrySettings = next;
  });
  return next;
}

export function sellerNeedsPayouts(profile: Profile | undefined | null): boolean {
  if (isPantryMode()) return false;
  if (profile?.isPantrySeller) return false;
  return true;
}

export function pantryPublicConfig() {
  const settings = getPantrySettings();
  return {
    pantryMode: settings.enabled,
    defaultPatronCap: settings.defaultPatronCap,
    basketHoldTtlMinutes: settings.basketHoldTtlMinutes,
    lowStockThreshold: settings.lowStockThreshold,
  };
}
