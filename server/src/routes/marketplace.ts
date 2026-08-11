import { Router } from "express";
import { z } from "zod";

import { isAdminAllowlisted, syncAdminRoleForUser } from "../adminAuth.js";
import { requireAuth } from "../auth.js";
import { LISTING_CATEGORIES } from "../categories.js";
import { COMPARTMENT_SIZES } from "../compartmentSizes.js";
import { getDb, mutateDb, newId, resetDb } from "../db.js";
import {
  deadlineFromNow,
  ensurePickupVerifiedFromRelai,
  finalizeOrderEscrow,
  refundOrderEscrow,
  resolvePickupDeadline,
  sellerAcceptHours,
  sellerDropOffHours,
  sweepBuyerNoShows,
  sweepSellerTimeouts,
} from "../escrow.js";
import {
  assertAuthorizedPayment,
  cancelAuthorizedPayment,
  refreshSellerPayoutReadiness,
} from "../payments.js";
import { SEED_SELLER_USER_ID } from "../seed.js";
import { paymentsEnabled } from "../stripe.js";
import type { Listing, MarketplaceRole, Order, Profile } from "../types.js";

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
  const listing = db.listings.find(l => l.id === order.listingId);
  if (listing && listing.sellerUserId === SEED_SELLER_USER_ID) {
    listing.sellerUserId = user.userId;
    listing.sellerEmail = user.email;
    listing.sellerName = user.name;
    listing.updatedAt = new Date().toISOString();
  }
}

/** Self-serve roles only — `admin` is never accepted from the client. */
const rolesSchema = z.object({
  roles: z.array(z.enum(["buyer", "seller"])).min(1),
  bio: z.string().max(280).optional(),
});

const listingSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  priceCents: z.number().int().min(0).max(100_000_000),
  category: z.enum(LISTING_CATEGORIES),
  compartmentSize: z.enum(["S", "M", "L"]),
  condition: z
    .enum(["new", "like_new", "good", "fair"])
    .default("good"),
  locationLabel: z.string().trim().max(120).default("Local Exchange Zone"),
});

marketplaceRouter.get("/categories", (_req, res) => {
  res.json({ data: [...LISTING_CATEGORIES] });
});

/** Exchange Zone Full Tower compartment sizes every listing must fit. */
marketplaceRouter.get("/compartment-sizes", (_req, res) => {
  res.json({
    data: COMPARTMENT_SIZES,
    tower: {
      name: "Full Tower",
      doors: 18,
      exteriorIn: { height: 76, width: 37.5, depth: 23 },
      note: "All Swap items must fit a Relai Exchange Zone compartment.",
    },
  });
});

marketplaceRouter.get("/listings", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const category = String(req.query.category ?? "").trim();
  const compartmentSize = String(req.query.compartmentSize ?? "").trim();
  const status = String(req.query.status ?? "available").trim();
  const sellerUserId = String(req.query.sellerUserId ?? "").trim();

  let items = [...getDb().listings];
  if (status && status !== "all") {
    items = items.filter(l => l.status === status);
  }
  if (category) {
    items = items.filter(l => l.category.toLowerCase() === category.toLowerCase());
  }
  if (compartmentSize) {
    items = items.filter(l => l.compartmentSize === compartmentSize);
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
  res.json(profile);
});

marketplaceRouter.put("/me/profile", requireAuth, async (req, res) => {
  const parsed = rolesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }
  const user = req.user!;
  const ts = new Date().toISOString();
  const selfServeRoles = [...new Set(parsed.data.roles)] as MarketplaceRole[];
  // Preserve/grant admin from allowlist only — never from request body.
  if (isAdminAllowlisted(user)) {
    selfServeRoles.push("admin");
  }
  const roles = [...new Set(selfServeRoles)];
  let profile: Profile | undefined;

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    if (idx >= 0) {
      const current = db.profiles[idx]!;
      profile = {
        ...current,
        email: user.email,
        name: user.name,
        roles,
        bio: parsed.data.bio ?? current.bio,
        updatedAt: ts,
      };
      db.profiles[idx] = profile;
    } else {
      profile = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        roles,
        bio: parsed.data.bio ?? "",
        stripeAccountId: null,
        stripePayoutsReady: false,
        createdAt: ts,
        updatedAt: ts,
      };
      db.profiles.push(profile);
    }
  });

  res.json(profile);
});

marketplaceRouter.post("/listings", requireAuth, async (req, res) => {
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Seller role required to post listings.",
    });
    return;
  }

  const parsed = listingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }

  const ts = new Date().toISOString();
  const listing: Listing = {
    id: newId("lst"),
    sellerUserId: user.userId,
    sellerEmail: user.email,
    sellerName: user.name,
    title: parsed.data.title,
    description: parsed.data.description,
    priceCents: parsed.data.priceCents,
    category: parsed.data.category,
    compartmentSize: parsed.data.compartmentSize,
    condition: parsed.data.condition,
    locationLabel: parsed.data.locationLabel,
    status: "available",
    imageColor: "#4B5563",
    createdAt: ts,
    updatedAt: ts,
  };

  await mutateDb(db => {
    db.listings.unshift(listing);
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
    Object.assign(listing, parsed.data, { updatedAt: new Date().toISOString() });
    updated = listing;
  });
  res.json(updated);
});

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
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("buyer")) {
    res.status(403).json({
      code: "buyer_required",
      message: "Buyer role required to purchase.",
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
      listing.updatedAt = ts;
      order = {
        id: newId("ord"),
        listingId: listing.id,
        buyerUserId: user.userId,
        sellerUserId: listing.sellerUserId,
        priceCents: listing.priceCents,
        status: "pending_accept",
        exchangeZoneId: parsedCheckout.data.exchangeZoneId,
        exchangeZoneName: parsedCheckout.data.exchangeZoneName,
        exchangeZoneAddress: parsedCheckout.data.exchangeZoneAddress ?? null,
        compartmentSize: listing.compartmentSize,
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
  const user = req.user!;
  const role = String(req.query.as ?? "buyer");
  const orders = getDb().orders.filter(o =>
    role === "seller" ? isOrderSeller(o, user.userId) : o.buyerUserId === user.userId,
  );
  const enriched = orders.map(o => ({
    ...o,
    listing: getDb().listings.find(l => l.id === o.listingId) ?? null,
  }));
  res.json({ data: enriched });
});

marketplaceRouter.get("/orders/:id", requireAuth, (req, res) => {
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
  res.json({
    ...order,
    listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
  });
});

marketplaceRouter.post("/orders/:id/accept", requireAuth, async (req, res) => {
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Seller role required to accept orders.",
    });
    return;
  }
  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!isOrderSeller(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Only the seller can accept." });
    return;
  }
  if (existing.status !== "pending_accept") {
    res.status(409).json({
      code: "invalid_status",
      message: "Only pending orders can be accepted.",
    });
    return;
  }

  if (paymentsEnabled()) {
    const ready = await refreshSellerPayoutReadiness(user.userId);
    if (!ready) {
      res.status(403).json({
        code: "seller_payouts_required",
        message:
          "Set up Stripe payouts in Account before accepting orders. Funds release to you on buyer pickup.",
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
  res.json(order);
});

marketplaceRouter.post("/orders/:id/drop-off", requireAuth, async (req, res) => {
  const user = req.user!;
  const bodySchema = z.object({
    relaiOrderId: z.string().min(1),
    pickupLinkCode: z.string().min(1),
    pickupLinkExpiresAt: z.string().nullable().optional(),
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
      message: "Seller role required to drop off.",
    });
    return;
  }

  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!isOrderSeller(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Only the seller can drop off." });
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
    order.updatedAt = ts;
  });
  res.json(order);
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
      message: "Only the buyer can confirm pickup and release escrow.",
    });
    return;
  }
  if (existing.status === "completed") {
    res.json({
      ...existing,
      listing: getDb().listings.find(l => l.id === existing.listingId) ?? null,
    });
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
    res.json({
      ...order,
      listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "seller_payouts_unavailable"
          ? "Seller must finish Stripe payout setup before funds can be released."
          : code === "payment_capture_failed"
            ? "Could not capture the buyer's payment."
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
  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  if (!canAccessOrder(existing, user.userId)) {
    res.status(403).json({ code: "forbidden", message: "Not your order." });
    return;
  }
  if (
    existing.status !== "pending_accept" &&
    existing.status !== "accepted"
  ) {
    res.status(409).json({
      code: "invalid_status",
      message:
        "After drop-off, use Cancel & refund instead of cancel. Completed orders cannot be cancelled.",
    });
    return;
  }

  try {
    await cancelAuthorizedPayment(existing.stripePaymentIntentId);
  } catch {
    res.status(502).json({
      code: "payment_cancel_failed",
      message: "Could not release the authorized payment. Try again.",
    });
    return;
  }

  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === req.params.id)!;
    const ts = new Date().toISOString();
    order.status = "cancelled";
    order.cancelledReason = "buyer_or_seller_cancel";
    order.paymentStatus =
      order.paymentStatus === "authorized" ? "cancelled" : order.paymentStatus;
    order.updatedAt = ts;
    const listing = db.listings.find(l => l.id === order!.listingId);
    if (listing && listing.status === "reserved") {
      listing.status = "available";
      listing.updatedAt = ts;
    }
  });
  res.json(order);
});

/** Post-drop-off: void/refund buyer funds and cancel the marketplace order. */
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
  if (existing.status !== "ready_for_pickup") {
    res.status(409).json({
      code: "invalid_status",
      message:
        "Refund is only available while the order is ready for pickup (after drop-off, before completion).",
    });
    return;
  }

  try {
    const order = await refundOrderEscrow(existing.id, "post_dropoff_refund");
    res.json({
      ...order,
      listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "payment_refund_failed"
          ? "Could not refund the payment. Try again or check Stripe."
          : code === "payment_disputed"
            ? "This payment is under dispute and cannot be refunded here."
            : code === "escrow_busy"
              ? "Escrow is busy. Try again in a moment."
              : "Could not refund this order.",
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
