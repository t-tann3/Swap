import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { getDb, mutateDb, newId } from "../db.js";
import {
  deadlineFromNow,
  sellerAcceptHours,
  sellerDropOffHours,
} from "../escrow.js";
import {
  basketUnitCount,
  consumeListingUnits,
  getPatronAllocation,
  isPantryMode,
  isPatronBlocked,
  listingAvailableUnits,
  listingBasketLimit,
  listingMaxPerOrder,
  releaseListingUnits,
} from "../pantry.js";
import type { Basket, Listing, Order } from "../types.js";

export const basketRouter = Router();

function assertNotBlocked(userId: string) {
  const profile = getDb().profiles.find(p => p.userId === userId);
  if (isPatronBlocked(profile)) {
    throw Object.assign(new Error("patron_blocked"), { status: 403 });
  }
}

function basketResponse(userId: string) {
  const basket =
    getDb().baskets.find(b => b.userId === userId) ??
    ({ userId, items: [], updatedAt: new Date().toISOString() } as Basket);
  const allocation = getPatronAllocation(userId);
  const items = basket.items.map(item => {
    const listing = getDb().listings.find(l => l.id === item.listingId) ?? null;
    return {
      ...item,
      listing,
      maxPerOrder: listing ? listingMaxPerOrder(listing) : 1,
      basketLimit: listing
        ? listingBasketLimit(listing, item.quantity)
        : 0,
    };
  });
  return { basket: { ...basket, items }, allocation };
}

function releaseBasketHolds(
  listings: Listing[],
  items: { listingId: string; quantity: number }[],
  ts: string,
) {
  for (const item of items) {
    const listing = listings.find(l => l.id === item.listingId);
    if (listing) releaseListingUnits(listing, item.quantity, ts);
  }
}

basketRouter.get("/me/basket", requireAuth, (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket is only available when pantry mode is on.",
    });
    return;
  }
  res.json(basketResponse(req.user!.userId));
});

basketRouter.post("/me/basket/items", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket is only available when pantry mode is on.",
    });
    return;
  }

  const parsed = z
    .object({
      listingId: z.string().min(1),
      quantity: z.number().int().min(1).max(20).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: "listingId required." });
    return;
  }

  const userId = req.user!.userId;
  const addQty = parsed.data.quantity ?? 1;
  const listingId = parsed.data.listingId;

  try {
    await mutateDb(db => {
      assertNotBlocked(userId);
      const listing = db.listings.find(l => l.id === listingId);
      if (!listing) {
        throw Object.assign(new Error("not_found"), { status: 404 });
      }
      if (listing.sellerUserId === userId) {
        throw Object.assign(new Error("own_listing"), { status: 400 });
      }
      const available = listingAvailableUnits(listing);
      if (available < addQty) {
        throw Object.assign(new Error("insufficient_stock"), { status: 409 });
      }

      let basket = db.baskets.find(b => b.userId === userId);
      if (!basket) {
        basket = { userId, items: [], updatedAt: new Date().toISOString() };
        db.baskets.push(basket);
      }

      const existing = basket.items.find(i => i.listingId === listingId);
      const nextQty = (existing?.quantity ?? 0) + addQty;
      const itemCap = listingMaxPerOrder(listing);
      if (nextQty > itemCap) {
        throw Object.assign(new Error("item_cap_exceeded"), { status: 409 });
      }

      const allocation = getPatronAllocation(userId);
      const otherBasket = basketUnitCount({
        ...basket,
        items: basket.items.filter(i => i.listingId !== listingId),
      });
      const usedWithoutLine = otherBasket + allocation.openOrderUnits;
      const cap = allocation.cap;
      if (usedWithoutLine + nextQty > cap) {
        throw Object.assign(new Error("patron_cap_exceeded"), { status: 409 });
      }

      const ts = new Date().toISOString();
      try {
        consumeListingUnits(listing, addQty, ts);
      } catch {
        throw Object.assign(new Error("insufficient_stock"), { status: 409 });
      }
      if (existing) {
        existing.quantity = nextQty;
      } else {
        basket.items.push({ listingId, quantity: nextQty, addedAt: ts });
      }
      basket.updatedAt = ts;
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "patron_cap_exceeded"
          ? "This would exceed your pantry item cap. Remove items or wait for open pickups to complete."
          : code === "item_cap_exceeded"
            ? "You already have the maximum allowed of this item in your basket."
          : code === "patron_blocked"
            ? "Your pantry access is currently blocked. Contact the pantry."
          : code === "insufficient_stock"
            ? "Not enough stock for that quantity."
            : code === "unavailable"
              ? "That item is no longer available."
              : code === "own_listing"
                ? "You cannot reserve your own listing."
                : code === "not_found"
                  ? "Listing not found."
                  : "Could not update basket.",
    });
    return;
  }

  res.json(basketResponse(userId));
});

basketRouter.patch("/me/basket/items/:listingId", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket is only available when pantry mode is on.",
    });
    return;
  }

  const parsed = z
    .object({ quantity: z.number().int().min(0).max(20) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: "quantity required." });
    return;
  }

  const userId = req.user!.userId;
  const listingId = String(req.params.listingId ?? "");

  try {
    await mutateDb(db => {
      const basket = db.baskets.find(b => b.userId === userId);
      if (!basket) {
        throw Object.assign(new Error("not_found"), { status: 404 });
      }
      const qty = parsed.data.quantity;
      const existing = basket.items.find(i => i.listingId === listingId);
      const prevQty = existing?.quantity ?? 0;
      const ts = new Date().toISOString();

      if (qty === 0) {
        if (prevQty > 0) {
          const listing = db.listings.find(l => l.id === listingId);
          if (listing) releaseListingUnits(listing, prevQty, ts);
        }
        basket.items = basket.items.filter(i => i.listingId !== listingId);
        basket.updatedAt = ts;
        return;
      }

      if (qty > prevQty) assertNotBlocked(userId);

      const listing = db.listings.find(l => l.id === listingId);
      if (!listing) {
        throw Object.assign(new Error("not_found"), { status: 404 });
      }
      if (qty > listingMaxPerOrder(listing)) {
        throw Object.assign(new Error("item_cap_exceeded"), { status: 409 });
      }
      const delta = qty - prevQty;
      if (delta > 0 && listingAvailableUnits(listing) < delta) {
        throw Object.assign(new Error("insufficient_stock"), { status: 409 });
      }
      const allocation = getPatronAllocation(userId);
      const otherBasket = basketUnitCount({
        ...basket,
        items: basket.items.filter(i => i.listingId !== listingId),
      });
      if (otherBasket + allocation.openOrderUnits + qty > allocation.cap) {
        throw Object.assign(new Error("patron_cap_exceeded"), { status: 409 });
      }

      if (delta > 0) {
        try {
          consumeListingUnits(listing, delta, ts);
        } catch {
          throw Object.assign(new Error("insufficient_stock"), { status: 409 });
        }
      } else if (delta < 0) {
        releaseListingUnits(listing, -delta, ts);
      }

      if (existing) existing.quantity = qty;
      else basket.items.push({ listingId, quantity: qty, addedAt: ts });
      basket.updatedAt = ts;
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "patron_cap_exceeded"
          ? "This would exceed your pantry item cap."
          : code === "item_cap_exceeded"
            ? "That quantity exceeds the per-item cap for this food."
          : code === "patron_blocked"
            ? "Your pantry access is currently blocked. Contact the pantry."
          : code === "insufficient_stock"
            ? "Not enough stock for that quantity."
            : "Could not update basket item.",
    });
    return;
  }

  res.json(basketResponse(userId));
});

basketRouter.delete("/me/basket/items/:listingId", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket is only available when pantry mode is on.",
    });
    return;
  }
  const userId = req.user!.userId;
  const listingId = String(req.params.listingId ?? "");
  await mutateDb(db => {
    const basket = db.baskets.find(b => b.userId === userId);
    if (!basket) return;
    const existing = basket.items.find(i => i.listingId === listingId);
    const ts = new Date().toISOString();
    if (existing) {
      const listing = db.listings.find(l => l.id === listingId);
      if (listing) releaseListingUnits(listing, existing.quantity, ts);
    }
    basket.items = basket.items.filter(i => i.listingId !== listingId);
    basket.updatedAt = ts;
  });
  res.json(basketResponse(userId));
});

basketRouter.delete("/me/basket", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket is only available when pantry mode is on.",
    });
    return;
  }
  const userId = req.user!.userId;
  await mutateDb(db => {
    const basket = db.baskets.find(b => b.userId === userId);
    if (!basket) return;
    const ts = new Date().toISOString();
    releaseBasketHolds(db.listings, basket.items, ts);
    basket.items = [];
    basket.updatedAt = ts;
  });
  res.json(basketResponse(userId));
});

/**
 * Checkout basket → one pantry order for the whole basket (items stay together).
 * Stock was hard-reserved when items were added; do not consume again.
 * All lines must share one seller (typical pantry org).
 */
basketRouter.post("/me/basket/checkout", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Basket checkout requires pantry mode.",
    });
    return;
  }

  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("buyer")) {
    res.status(403).json({
      code: "buyer_required",
      message: "Buyer role required to check out a pantry basket.",
    });
    return;
  }
  if (isPatronBlocked(profile)) {
    res.status(403).json({
      code: "patron_blocked",
      message: "Your pantry access is currently blocked. Contact the pantry.",
    });
    return;
  }

  const checkoutSchema = z.object({
    exchangeZoneId: z.string().min(1),
    exchangeZoneName: z.string().min(1),
    exchangeZoneAddress: z.string().nullable().optional(),
  });
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "exchange_zone_required",
      message: "Choose an Exchange Zone for pickup.",
    });
    return;
  }

  let created: Order | undefined;

  try {
    await mutateDb(db => {
      const basket = db.baskets.find(b => b.userId === user.userId);
      if (!basket || basket.items.length === 0) {
        throw Object.assign(new Error("basket_empty"), { status: 400 });
      }

      const allocation = getPatronAllocation(user.userId);
      const units = basketUnitCount(basket);
      if (allocation.openOrderUnits + units > allocation.cap) {
        throw Object.assign(new Error("patron_cap_exceeded"), { status: 409 });
      }

      const ts = new Date().toISOString();
      const lines: { listingId: string; quantity: number; title: string }[] =
        [];
      let sellerUserId: string | null = null;

      for (const item of [...basket.items]) {
        const listing = db.listings.find(l => l.id === item.listingId);
        if (
          !listing ||
          listing.status === "cancelled" ||
          listing.status === "draft" ||
          listing.status === "sold"
        ) {
          throw Object.assign(new Error("unavailable"), { status: 409 });
        }
        if (item.quantity > listingMaxPerOrder(listing)) {
          throw Object.assign(new Error("item_cap_exceeded"), { status: 409 });
        }
        if (sellerUserId == null) sellerUserId = listing.sellerUserId;
        else if (listing.sellerUserId !== sellerUserId) {
          throw Object.assign(new Error("mixed_sellers"), { status: 409 });
        }
        lines.push({
          listingId: listing.id,
          quantity: item.quantity,
          title: listing.title,
        });
        if ((listing.stockQty ?? 0) <= 0) {
          listing.status = "out_of_stock";
          listing.updatedAt = ts;
        }
      }

      if (!sellerUserId || lines.length === 0) {
        throw Object.assign(new Error("unavailable"), { status: 409 });
      }

      const order: Order = {
        id: newId("ord"),
        listingId: lines[0]!.listingId,
        items: lines,
        buyerUserId: user.userId,
        sellerUserId,
        priceCents: 0,
        status: "pending_accept",
        exchangeZoneId: parsed.data.exchangeZoneId,
        exchangeZoneName: parsed.data.exchangeZoneName,
        exchangeZoneAddress: parsed.data.exchangeZoneAddress ?? null,
        dropOffPhotoUrl: null,
        relaiOrderId: null,
        pickupLinkCode: null,
        pickupLinkExpiresAt: null,
        sellerAcceptDeadlineAt: deadlineFromNow(sellerAcceptHours(), ts),
        sellerDropOffDeadlineAt: null,
        relaiPickupVerifiedAt: null,
        relaiWebhookEventId: null,
        pickupVerifiedVia: null,
        stripePaymentIntentId: null,
        stripeTransferId: null,
        stripeRefundId: null,
        transferLastError: null,
        paymentStatus: "none",
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
      created = order;

      basket.items = [];
      basket.updatedAt = ts;
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "basket_empty"
          ? "Your basket is empty."
          : code === "patron_cap_exceeded"
            ? "Checkout would exceed your pantry cap."
            : code === "unavailable"
              ? "An item in your basket is no longer available. Update your basket and try again."
              : code === "item_cap_exceeded"
                ? "An item exceeds its per-item cap. Lower the quantity and try again."
                : code === "mixed_sellers"
                  ? "Checkout one pantry seller at a time. Remove items from other sellers and try again."
                  : "Could not check out basket.",
    });
    return;
  }

  res.status(201).json({
    count: 1,
    data: [
      {
        ...created!,
        listing:
          getDb().listings.find(l => l.id === created!.listingId) ?? null,
        items: created!.items.map(line => ({
          ...line,
          listing: getDb().listings.find(l => l.id === line.listingId) ?? null,
        })),
      },
    ],
    allocation: getPatronAllocation(user.userId),
  });
});
