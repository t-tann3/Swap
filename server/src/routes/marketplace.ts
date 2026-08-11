import { Router } from "express";
import { z } from "zod";

import { isAdminAllowlisted, profileClientPayload, syncAdminRoleForUser } from "../adminAuth.js";
import { requireAuth } from "../auth.js";
import { LISTING_CATEGORIES } from "../categories.js";
import { getDb, mutateDb, newId, refreshDb, resetDb } from "../db.js";
import {
  deadlineFromNow,
  ensurePickupVerifiedFromRelai,
  finalizeOrderEscrow,
  openPlatformDispute,
  resolvePickupDeadline,
  sellerAcceptHours,
  sellerDropOffHours,
  sweepBuyerNoShows,
  sweepSellerTimeouts,
  voidPreDropoffEscrow,
} from "../escrow.js";
import {
  assertAuthorizedPayment,
  cancelAuthorizedPayment,
  refreshSellerPayoutReadiness,
} from "../payments.js";
import {
  applyStockAdjustment,
  fulfillmentBucket,
  fulfillmentSortKey,
  getPantrySettings,
  isPantryMode,
  sellerInventory,
  sellerNeedsPayouts,
  syncListingStockStatus,
} from "../pantry.js";
import { SEED_SELLER_USER_ID } from "../seed.js";
import { paymentsEnabled } from "../stripe.js";
import type { Listing, MarketplaceRole, Order, Profile } from "../types.js";
import { isOwnedUploadUrl } from "../uploads.js";

export const marketplaceRouter = Router();

/** Sandbox: any signed-in seller can fulfill seeded demo inventory. */
function demoSellerFulfillmentEnabled(): boolean {
  return process.env.ALLOW_RESEED === "true";
}

function isOrderSeller(order: Order, userId: string): boolean {
  if (order.sellerUserId === userId) return true;
  return (
    demoSellerFulfillmentEnabled() && order.sellerUserId === SEED_SELLER_USER_ID
  );
}

function canAccessOrder(order: Order, userId: string): boolean {
  return order.buyerUserId === userId || isOrderSeller(order, userId);
}

/** When a real seller accepts a seed order, become the listing/order owner. */
function adoptSeedSellerAssets(
  db: { listings: Listing[]; orders: Order[] },
  order: Order,
  user: { userId: string; email: string | null; name: string | null },
): void {
  if (order.sellerUserId !== SEED_SELLER_USER_ID) return;
  order.sellerUserId = user.userId;
  const listingIds = new Set(
    (order.items?.length
      ? order.items.map(i => i.listingId)
      : [order.listingId]
    ).filter(Boolean),
  );
  for (const listingId of listingIds) {
    const listing = db.listings.find(l => l.id === listingId);
    if (listing && listing.sellerUserId === SEED_SELLER_USER_ID) {
      listing.sellerUserId = user.userId;
      listing.sellerEmail = user.email;
      listing.sellerName = user.name;
      listing.updatedAt = new Date().toISOString();
    }
  }
}

function enrichOrder(order: Order) {
  const items = (order.items?.length
    ? order.items
    : [{ listingId: order.listingId, quantity: 1, title: "Item" }]
  ).map(line => ({
    ...line,
    listing: getDb().listings.find(l => l.id === line.listingId) ?? null,
  }));
  const buyer = getDb().profiles.find(p => p.userId === order.buyerUserId);
  return {
    ...order,
    items,
    listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
    buyerEmail: buyer?.email ?? null,
  };
}

/** Self-serve roles — `admin` is allowlist-only; `adminEnabled` opts in/out for allowlisted users. */
const rolesSchema = z.object({
  roles: z.array(z.enum(["buyer", "seller"])).min(1),
  bio: z.string().max(280).optional(),
  adminEnabled: z.boolean().optional(),
});

const listingSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  priceCents: z.number().int().min(0).max(100_000_000),
  category: z.enum(LISTING_CATEGORIES),
  condition: z
    .enum(["new", "like_new", "good", "fair"])
    .default("good"),
  locationLabel: z.string().trim().max(120).default("Local Exchange Zone"),
  stockQty: z.number().int().min(1).max(500).optional(),
  maxPerOrder: z.number().int().min(1).max(50).optional(),
  imageUrl: z
    .string()
    .nullable()
    .optional()
    .refine(v => v == null || isOwnedUploadUrl(v), {
      message: "imageUrl must be a Swap upload path (/uploads/…).",
    }),
});

marketplaceRouter.get("/categories", (_req, res) => {
  res.json({ data: [...LISTING_CATEGORIES] });
});

marketplaceRouter.get("/listings", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const category = String(req.query.category ?? "").trim();
  const status = String(req.query.status ?? "available").trim();
  const sellerUserId = String(req.query.sellerUserId ?? "").trim();

  let items = [...getDb().listings];
  if (status && status !== "all") {
    items = items.filter(l => l.status === status);
  }
  if (category) {
    items = items.filter(l => l.category.toLowerCase() === category.toLowerCase());
  }
  if (sellerUserId) {
    items = items.filter(l => l.sellerUserId === sellerUserId);
  }
  if (q) {
    items = items.filter(
      l =>
        l.title.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q),
    );
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ data: items });
});

marketplaceRouter.get("/listings/:id", (req, res) => {
  const listing = getDb().listings.find(l => l.id === req.params.id);
  if (!listing) {
    res.status(404).json({ code: "not_found", message: "Listing not found." });
    return;
  }
  res.json(listing);
});

marketplaceRouter.get("/me/profile", requireAuth, async (req, res) => {
  const profile = await syncAdminRoleForUser(req.user!);
  res.json(profileClientPayload(req.user!, profile));
});

marketplaceRouter.put("/me/profile", requireAuth, async (req, res) => {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }
  const user = req.user!;
  const ts = new Date().toISOString();
  const selfServe = [...new Set(parsed.data.roles)] as MarketplaceRole[];
  const onAllowlist = isAdminAllowlisted(user);
  let profile: Profile | undefined;

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    const current = idx >= 0 ? db.profiles[idx]! : null;
    let adminOptOut = current?.adminOptOut ?? false;
    if (onAllowlist && parsed.data.adminEnabled !== undefined) {
      adminOptOut = !parsed.data.adminEnabled;
    }
    if (!onAllowlist) adminOptOut = false;

    const roles: MarketplaceRole[] =
      onAllowlist && !adminOptOut
        ? [...selfServe, "admin"]
        : selfServe;

    if (idx >= 0) {
      profile = {
        ...current!,
        email: user.email,
        name: user.name,
        roles: [...new Set(roles)],
        bio: parsed.data.bio ?? current!.bio,
        adminOptOut,
        updatedAt: ts,
      };
      db.profiles[idx] = profile;
    } else {
      profile = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        roles: [...new Set(roles)],
        bio: parsed.data.bio ?? "",
        stripeAccountId: null,
        stripePayoutsReady: false,
        patronCap: null,
        isPantrySeller: false,
        pantryBlocked: false,
        adminOptOut,
        createdAt: ts,
        updatedAt: ts,
      };
      db.profiles.push(profile);
    }
  });

  res.json(profileClientPayload(user, profile!));
});

marketplaceRouter.post("/listings", requireAuth, async (req, res) => {
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Pantry role required to post listings.",
    });
    return;
  }

  const parsed = listingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }

  const pantry = isPantryMode();
  const ts = new Date().toISOString();
  const listing: Listing = {
    id: newId("lst"),
    sellerUserId: user.userId,
    sellerEmail: user.email,
    sellerName: user.name,
    title: parsed.data.title,
    description: parsed.data.description,
    priceCents: pantry ? 0 : parsed.data.priceCents,
    category: parsed.data.category,
    condition: parsed.data.condition,
    locationLabel: parsed.data.locationLabel,
    status: "available",
    imageColor: "#4B5563",
    imageUrl: parsed.data.imageUrl ?? null,
    stockQty: pantry ? (parsed.data.stockQty ?? 1) : 1,
    maxPerOrder: pantry ? (parsed.data.maxPerOrder ?? 1) : 1,
    createdAt: ts,
    updatedAt: ts,
  };

  await mutateDb(db => {
    db.listings.unshift(listing);
    if (pantry) {
      const p = db.profiles.find(x => x.userId === user.userId);
      if (p) {
        p.isPantrySeller = true;
        p.updatedAt = ts;
      }
    }
  });
  res.status(201).json(listing);
});

marketplaceRouter.patch("/listings/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const parsed = listingSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }

  const existing = getDb().listings.find(l => l.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Listing not found." });
    return;
  }
  if (existing.sellerUserId !== user.userId) {
    res.status(403).json({ code: "forbidden", message: "Not your listing." });
    return;
  }

  let updated: Listing | undefined;
  await mutateDb(db => {
    const listing = db.listings.find(l => l.id === req.params.id)!;
    const ts = new Date().toISOString();
    Object.assign(listing, parsed.data, { updatedAt: ts });
    if (parsed.data.stockQty !== undefined) {
      syncListingStockStatus(listing, ts);
    }
    updated = listing;
  });
  res.json(updated);
});

marketplaceRouter.get("/me/inventory", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Inventory is only available when pantry mode is on.",
    });
    return;
  }
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Pantry role required.",
    });
    return;
  }
  await refreshDb();
  const settings = getPantrySettings();
  res.json({
    lowStockThreshold: settings.lowStockThreshold,
    data: sellerInventory(user.userId),
  });
});

marketplaceRouter.post(
  "/listings/:id/stock-adjust",
  requireAuth,
  async (req, res) => {
    if (!isPantryMode()) {
      res.status(409).json({
        code: "pantry_disabled",
        message: "Stock adjustments require pantry mode.",
      });
      return;
    }
    const parsed = z
      .object({
        delta: z.number().int().min(-500).max(500),
        reason: z.string().trim().max(200).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        code: "invalid_body",
        message: "delta required.",
      });
      return;
    }
    if (parsed.data.delta === 0) {
      res.status(400).json({ code: "invalid_delta", message: "delta cannot be 0." });
      return;
    }

    const user = req.user!;
    const existing = getDb().listings.find(l => l.id === req.params.id);
    if (!existing) {
      res.status(404).json({ code: "not_found", message: "Listing not found." });
      return;
    }
    if (existing.sellerUserId !== user.userId) {
      res.status(403).json({ code: "forbidden", message: "Not your listing." });
      return;
    }

    let adjustment;
    let listing: Listing | undefined;
    try {
      await mutateDb(db => {
        const row = db.listings.find(l => l.id === req.params.id)!;
        const ts = new Date().toISOString();
        adjustment = applyStockAdjustment(
          row,
          user.userId,
          parsed.data.delta,
          parsed.data.reason ?? "",
          ts,
        );
        if (!db.stockAdjustments) db.stockAdjustments = [];
        db.stockAdjustments.unshift(adjustment);
        // Cap ledger growth in the JSON/Mongo demo DB.
        if (db.stockAdjustments.length > 500) {
          db.stockAdjustments.length = 500;
        }
        listing = row;
      });
    } catch (err) {
      const code = (err as Error).message;
      res.status(400).json({
        code,
        message: "Could not adjust stock.",
      });
      return;
    }
    res.json({ listing, adjustment });
  },
);

marketplaceRouter.delete("/listings/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const existing = getDb().listings.find(l => l.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Listing not found." });
    return;
  }
  if (existing.sellerUserId !== user.userId) {
    res.status(403).json({ code: "forbidden", message: "Not your listing." });
    return;
  }
  if (existing.status === "reserved") {
    res.status(409).json({
      code: "listing_reserved",
      message: "Cancel the order before deleting a reserved listing.",
    });
    return;
  }

  await mutateDb(db => {
    const listing = db.listings.find(l => l.id === req.params.id)!;
    listing.status = "cancelled";
    listing.updatedAt = new Date().toISOString();
  });
  res.json({ ok: true });
});

marketplaceRouter.post("/listings/:id/buy", requireAuth, async (req, res) => {
  if (isPantryMode()) {
    res.status(409).json({
      code: "use_basket",
      message:
        "Pantry mode is on. Add items to your basket and check out together so your item cap is enforced.",
    });
    return;
  }
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("buyer")) {
    res.status(403).json({
      code: "buyer_required",
      message: "Neighbor role required to purchase.",
    });
    return;
  }

  const checkoutSchema = z.object({
    exchangeZoneId: z.string().min(1),
    exchangeZoneName: z.string().min(1),
    exchangeZoneAddress: z.string().nullable().optional(),
    paymentIntentId: z.string().min(1).optional(),
  });
  const parsedCheckout = checkoutSchema.safeParse(req.body ?? {});
  if (!parsedCheckout.success) {
    res.status(400).json({
      code: "exchange_zone_required",
      message: "Choose an Exchange Zone for drop-off.",
    });
    return;
  }

  const listingPreview = getDb().listings.find(l => l.id === req.params.id);
  if (!listingPreview) {
    res.status(404).json({ code: "not_found", message: "Listing not found." });
    return;
  }

  let paymentIntentId: string | null = null;
  if (paymentsEnabled()) {
    if (!parsedCheckout.data.paymentIntentId) {
      res.status(400).json({
        code: "payment_required",
        message: "Authorize payment before placing the order.",
      });
      return;
    }
    try {
      await assertAuthorizedPayment({
        paymentIntentId: parsedCheckout.data.paymentIntentId,
        buyerUserId: user.userId,
        listingId: listingPreview.id,
        priceCents: listingPreview.priceCents,
      });
      paymentIntentId = parsedCheckout.data.paymentIntentId;
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      const code = (err as Error).message;
      res.status(status).json({
        code,
        message:
          code === "payment_not_authorized"
            ? "Payment is not authorized. Complete card payment and try again."
            : "Payment could not be verified for this listing.",
      });
      return;
    }
  }

  let order: Order | undefined;
  let listing: Listing | undefined;

  try {
    await mutateDb(db => {
      listing = db.listings.find(l => l.id === req.params.id);
      if (!listing) {
        throw Object.assign(new Error("not_found"), { status: 404 });
      }
      if (listing.sellerUserId === user.userId) {
        throw Object.assign(new Error("own_listing"), { status: 400 });
      }
      if (listing.status !== "available") {
        throw Object.assign(new Error("unavailable"), { status: 409 });
      }
      const ts = new Date().toISOString();
      listing.status = "reserved";
      listing.stockQty = 0;
      listing.updatedAt = ts;
      order = {
        id: newId("ord"),
        listingId: listing.id,
        items: [
          {
            listingId: listing.id,
            quantity: 1,
            title: listing.title,
          },
        ],
        buyerUserId: user.userId,
        sellerUserId: listing.sellerUserId,
        priceCents: listing.priceCents,
        status: "pending_accept",
        exchangeZoneId: parsedCheckout.data.exchangeZoneId,
        exchangeZoneName: parsedCheckout.data.exchangeZoneName,
        exchangeZoneAddress: parsedCheckout.data.exchangeZoneAddress ?? null,
        dropOffPhotoUrl: null,
        relaiOrderId: null,
        pickupLinkCode: null,
        pickupLinkExpiresAt: null,
        sellerAcceptDeadlineAt: deadlineFromNow(sellerAcceptHours(), ts),
        sellerDropOffDeadlineAt: null,
        relaiPickupVerifiedAt: null,
        relaiWebhookEventId: null,
        pickupVerifiedVia: null,
        stripePaymentIntentId: paymentIntentId,
        stripeTransferId: null,
        stripeRefundId: null,
        transferLastError: null,
        paymentStatus: paymentIntentId ? "authorized" : "none",
        paymentStatusBeforeDispute: null,
        stripeDisputeId: null,
        disputeStatus: null,
        adminHold: false,
        platformDisputeReason: null,
        platformDisputeOpenedBy: null,
        platformDisputeOpenedAt: null,
        completedReason: null,
        cancelledReason: null,
        createdAt: ts,
        updatedAt: ts,
        completedAt: null,
      };
      db.orders.unshift(order);
    });
  } catch (err) {
    if (paymentIntentId) {
      await cancelAuthorizedPayment(paymentIntentId).catch(() => undefined);
    }
    const status = (err as { status?: number }).status ?? 500;
    const code =
      status === 404
        ? "not_found"
        : status === 400
          ? "own_listing"
          : status === 409
            ? "unavailable"
            : "error";
    res.status(status).json({
      code,
      message:
        code === "own_listing"
          ? "You cannot buy your own listing."
          : code === "unavailable"
            ? "This item is no longer available."
            : code === "not_found"
              ? "Listing not found."
              : "Purchase failed.",
    });
    return;
  }

  res.status(201).json({ order, listing });
});

marketplaceRouter.get("/orders", requireAuth, async (req, res) => {
  await sweepBuyerNoShows().catch(() => undefined);
  await refreshDb();
  const user = req.user!;
  const role = String(req.query.as ?? "buyer");
  const orders = getDb().orders.filter(o =>
    role === "seller" ? isOrderSeller(o, user.userId) : o.buyerUserId === user.userId,
  );
  const enriched = orders.map(o => enrichOrder(o));
  res.json({ data: enriched });
});

marketplaceRouter.get("/me/fulfillment", requireAuth, async (req, res) => {
  await sweepBuyerNoShows().catch(() => undefined);
  await refreshDb();
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Pantry role required.",
    });
    return;
  }
  const now = Date.now();
  const open = getDb()
    .orders.filter(
      o =>
        isOrderSeller(o, user.userId) &&
        (o.status === "pending_accept" ||
          o.status === "accepted" ||
          o.status === "ready_for_pickup"),
    )
    .map(o => {
      const enriched = enrichOrder(o);
      const bucket = fulfillmentBucket(o, now);
      return {
        ...enriched,
        fulfillmentBucket: bucket,
        overdue: bucket === "overdue",
      };
    })
    .sort(
      (a, b) =>
        fulfillmentSortKey(a as Order, now) - fulfillmentSortKey(b as Order, now),
    );

  const counts = {
    needs_accept: 0,
    needs_drop_off: 0,
    overdue: 0,
    ready: 0,
  };
  for (const o of open) {
    if (o.fulfillmentBucket) counts[o.fulfillmentBucket] += 1;
  }

  res.json({ counts, data: open });
});

marketplaceRouter.get("/orders/:id", requireAuth, async (req, res) => {
  await refreshDb();
  const user = req.user!;
  const order = getDb().orders.find(o => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!canAccessOrder(order, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Not your order." });
    return;
  }
  res.json(enrichOrder(order));
});

marketplaceRouter.post("/orders/:id/accept", requireAuth, async (req, res) => {
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Pantry role required to accept orders.",
    });
    return;
  }
  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!isOrderSeller(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Only the pantry can accept." });
    return;
  }
  if (existing.status !== "pending_accept") {
    res.status(409).json({
      code: "invalid_status",
      message: "Only pending orders can be accepted.",
    });
    return;
  }

  if (paymentsEnabled() && sellerNeedsPayouts(profile)) {
    const ready = await refreshSellerPayoutReadiness(user.userId);
    if (!ready) {
      res.status(403).json({
        code: "seller_payouts_required",
        message:
          "Set up Stripe payouts in Account before accepting orders. Funds release to you on neighbor pickup.",
      });
      return;
    }
  }

  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === req.params.id)!;
    adoptSeedSellerAssets(db, order, user);
    const ts = new Date().toISOString();
    order.status = "accepted";
    order.sellerDropOffDeadlineAt = deadlineFromNow(sellerDropOffHours(), ts);
    order.updatedAt = ts;
  });
  res.json(enrichOrder(order!));
});

marketplaceRouter.post("/orders/:id/drop-off", requireAuth, async (req, res) => {
  const user = req.user!;
  const bodySchema = z.object({
    relaiOrderId: z.string().min(1),
    pickupLinkCode: z.string().min(1),
    pickupLinkExpiresAt: z.string().nullable().optional(),
    dropOffPhotoUrl: z
      .string()
      .nullable()
      .optional()
      .refine(v => v == null || v === "" || isOwnedUploadUrl(v), {
        message: "dropOffPhotoUrl must be a Swap upload path (/uploads/…).",
      }),
  });
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_body",
      message: "Drop-off requires a Relai order id and pickup link.",
    });
    return;
  }

  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Pantry role required to drop off.",
    });
    return;
  }

  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!isOrderSeller(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Only the pantry can drop off." });
    return;
  }
  if (existing.status !== "accepted") {
    res.status(409).json({
      code: "invalid_status",
      message: "Accept the order before dropping off.",
    });
    return;
  }

  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === req.params.id)!;
    adoptSeedSellerAssets(db, order, user);
    const ts = new Date().toISOString();
    order.status = "ready_for_pickup";
    order.relaiOrderId = parsed.data.relaiOrderId;
    order.pickupLinkCode = parsed.data.pickupLinkCode;
    order.pickupLinkExpiresAt = resolvePickupDeadline(
      parsed.data.pickupLinkExpiresAt,
      ts,
    );
    order.dropOffPhotoUrl = parsed.data.dropOffPhotoUrl || null;
    order.updatedAt = ts;
  });
  res.json(enrichOrder(order!));
});

marketplaceRouter.post("/orders/:id/complete", requireAuth, async (req, res) => {
  const user = req.user!;
  // Opportunistic sweeps so UI stays consistent without waiting for the timer.
  await sweepBuyerNoShows().catch(() => undefined);
  await sweepSellerTimeouts().catch(() => undefined);

  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (existing.buyerUserId !== user.userId) {
    res.status(403).json({
      code: "buyer_required",
      message: "Only the neighbor can confirm pickup and release escrow.",
    });
    return;
  }
  if (existing.status === "completed") {
    res.json(enrichOrder(existing));
    return;
  }
  if (existing.status !== "ready_for_pickup") {
    res.status(409).json({
      code: "invalid_status",
      message: "Order can only be completed after drop-off.",
    });
    return;
  }

  try {
    // Trusted release: Relai must confirm pickup (webhook may have already done this).
    // Polling Relai is the fallback when the client finishes unlock before the webhook arrives.
    await ensurePickupVerifiedFromRelai(existing);
    const order = await finalizeOrderEscrow(existing.id, "pickup");
    res.json(enrichOrder(order));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "seller_payouts_unavailable"
          ? "Pantry must finish Stripe payout setup before funds can be released."
          : code === "payment_capture_failed"
            ? "Could not capture the neighbor's payment."
            : code === "payment_disputed"
              ? "This payment is under dispute; escrow cannot be released yet."
              : code === "escrow_busy"
                ? "Escrow is already being finalized. Try again in a moment."
                : code === "pickup_not_verified"
                  ? "Waiting for Relai to confirm compartment pickup. Try again in a moment."
                  : code === "relai_secret_unconfigured"
                    ? "Server is missing RELAI_SECRET_KEY; cannot verify pickup with Relai."
                    : code === "relai_status_unavailable"
                      ? "Could not reach Relai to verify pickup. Try again shortly."
                      : code === "relai_order_missing"
                        ? "This order has no Relai pickup order to verify."
                        : "Could not release escrow payment.",
    });
  }
});

marketplaceRouter.post("/orders/:id/cancel", requireAuth, async (req, res) => {
  const user = req.user!;
  const orderId = String(req.params.id ?? "");
  const existing = getDb().orders.find(o => o.id === orderId);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!canAccessOrder(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Not your order." });
    return;
  }

  // After drop-off the item may already be in a locker — no self-serve cancel.
  if (existing.status === "ready_for_pickup") {
    const pantry = isPantryMode() || existing.priceCents === 0;
    res.status(409).json({
      code: pantry ? "in_locker_contact_pantry" : "in_locker_use_dispute",
      message: pantry
        ? "This basket may already be in an Exchange Zone. Contact the pantry to resolve — it cannot be cancelled here."
        : "This item may already be in an Exchange Zone. Open a dispute instead of cancelling — ops will refund or release after review.",
    });
    return;
  }

  try {
    if (
      existing.status === "pending_accept" ||
      existing.status === "accepted"
    ) {
      const order = await voidPreDropoffEscrow(
        existing.id,
        "buyer_or_seller_cancel",
      );
      res.json(enrichOrder(order));
      return;
    }

    const pantry = isPantryMode() || existing.priceCents === 0;
    res.status(409).json({
      code: "invalid_status",
      message:
        existing.status === "completed"
          ? pantry
            ? "Completed orders cannot be cancelled. Contact the pantry if something is wrong."
            : "Completed orders cannot be cancelled. Open a dispute if something is wrong."
          : existing.status === "cancelled"
            ? "This order is already cancelled."
            : `This order cannot be cancelled (status: ${existing.status}).`,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "payment_cancel_failed" || code === "payment_refund_failed"
          ? "Could not release the payment. Try again."
          : code === "payment_disputed"
            ? "This payment is under dispute and cannot be cancelled here."
            : code === "escrow_busy"
              ? "Escrow is busy. Try again in a moment."
              : code === "invalid_status"
                ? "This order can no longer be cancelled."
                : "Could not cancel this order.",
    });
  }
});

/**
 * Post-drop-off self-serve refund is disabled (item may be in a locker).
 * Kept for API compatibility — returns the same guidance as cancel.
 */
marketplaceRouter.post("/orders/:id/refund", requireAuth, async (req, res) => {
  const user = req.user!;
  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!canAccessOrder(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Not your order." });
    return;
  }

  const pantry = isPantryMode() || existing.priceCents === 0;
  res.status(409).json({
    code: pantry ? "pantry_no_refunds" : "in_locker_use_dispute",
    message: pantry
      ? existing.status === "ready_for_pickup"
        ? "This basket may already be in an Exchange Zone. Contact the pantry to resolve."
        : "Refunds are not used in pantry mode. Contact the pantry if you need help."
      : existing.status === "ready_for_pickup"
        ? "Self-serve refund is disabled after drop-off because the item may be in a locker. Open a dispute so ops can refund or release safely."
        : "Refund is only handled by ops after drop-off. Open a dispute if you need help.",
  });
});

marketplaceRouter.post("/orders/:id/dispute", requireAuth, async (req, res) => {
  const user = req.user!;
  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (isPantryMode() || (existing && existing.priceCents === 0)) {
    res.status(409).json({
      code: "pantry_no_disputes",
      message:
        "Disputes are not used in pantry mode. Contact the pantry to resolve issues.",
    });
    return;
  }
  const parsed = z
    .object({ reason: z.string().min(8).max(1000) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_body",
      message: "Provide a dispute reason (at least 8 characters).",
    });
    return;
  }

  try {
    const order = await openPlatformDispute(
      String(req.params.id ?? ""),
      user.userId,
      parsed.data.reason,
    );
    res.json(enrichOrder(order));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "forbidden"
          ? "Not your order."
          : code === "invalid_status"
            ? "Disputes can be opened after accept, while ready for pickup, or after completion."
            : code === "dispute_already_open"
              ? "A dispute is already open on this order."
              : code === "invalid_reason"
                ? "Provide a clearer dispute reason."
                : code === "not_found"
                  ? "Order not found."
                  : "Could not open dispute.",
    });
  }
});

marketplaceRouter.get("/favorites", requireAuth, (req, res) => {
  const user = req.user!;
  const favs = getDb().favorites.filter(f => f.userId === user.userId);
  const data = favs
    .map(f => getDb().listings.find(l => l.id === f.listingId))
    .filter((l): l is Listing => !!l && l.status !== "cancelled");
  res.json({ data });
});

marketplaceRouter.post("/favorites/:listingId", requireAuth, async (req, res) => {
  const user = req.user!;
  const listingId = String(req.params.listingId ?? "");
  const listing = getDb().listings.find(l => l.id === listingId);
  if (!listing) {
    res.status(404).json({ code: "not_found", message: "Listing not found." });
    return;
  }
  await mutateDb(db => {
    if (!db.favorites.some(f => f.userId === user.userId && f.listingId === listingId)) {
      db.favorites.push({
        userId: user.userId,
        listingId,
        createdAt: new Date().toISOString(),
      });
    }
  });
  res.status(201).json({ ok: true });
});

marketplaceRouter.delete("/favorites/:listingId", requireAuth, async (req, res) => {
  const user = req.user!;
  const listingId = String(req.params.listingId ?? "");
  await mutateDb(db => {
    db.favorites = db.favorites.filter(
      f => !(f.userId === user.userId && f.listingId === listingId),
    );
  });
  res.json({ ok: true });
});

/** @deprecated Prefer POST /api/admin/reseed with x-admin-key. */
marketplaceRouter.post("/admin/reseed", async (_req, res) => {
  if (process.env.ALLOW_RESEED !== "true") {
    res.status(403).json({ code: "forbidden", message: "Reseed disabled." });
    return;
  }
  const db = await resetDb();
  res.json({ ok: true, listings: db.listings.length });
});

/** @deprecated Prefer POST /api/admin/clear-except-listings with x-admin-key. */
marketplaceRouter.post("/admin/clear-except-listings", async (_req, res) => {
  if (process.env.ALLOW_RESEED !== "true") {
    res.status(403).json({ code: "forbidden", message: "Clear disabled." });
    return;
  }
  await mutateDb(db => {
    db.orders = [];
    db.favorites = [];
    db.profiles = db.profiles.filter(p => p.userId === SEED_SELLER_USER_ID);
    const ts = new Date().toISOString();
    for (const listing of db.listings) {
      if (listing.status === "reserved") {
        listing.status = "available";
        listing.updatedAt = ts;
      }
    }
  });
  const db = getDb();
  res.json({
    ok: true,
    listings: db.listings.length,
    orders: db.orders.length,
    favorites: db.favorites.length,
    profiles: db.profiles.length,
  });
});
