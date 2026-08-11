import { Router } from "express";
import { z } from "zod";

import { requireAdmin } from "../adminAuth.js";
import { getDb, mutateDb, resetDb } from "../db.js";
import {
  adminForceRefund,
  adminForceRelease,
  listEscrowAttentionOrders,
  runAllEscrowSweeps,
  retryStuckTransfer,
  setAdminHold,
} from "../escrow.js";
import { inspectOrderStripe } from "../payments.js";
import { SEED_SELLER_USER_ID } from "../seed.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function orderWithListing(orderId: string) {
  const order = getDb().orders.find(o => o.id === orderId);
  if (!order) return null;
  return {
    ...order,
    listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
  };
}

/** List orders needing ops attention (stuck / disputed / frozen / overdue). */
adminRouter.get("/orders/escrow", (req, res) => {
  const filter =
    typeof req.query.filter === "string" ? req.query.filter : "attention";
  const data = listEscrowAttentionOrders(filter).map(o => ({
    ...o,
    listing: getDb().listings.find(l => l.id === o.listingId) ?? null,
  }));
  res.json({ filter, count: data.length, data });
});

/** Inspect one order + live Stripe PI/transfer/refund/dispute snapshot. */
adminRouter.get("/orders/:id", async (req, res) => {
  const order = getDb().orders.find(o => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }
  try {
    const stripe = await inspectOrderStripe(order);
    res.json({
      order: {
        ...order,
        listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
      },
      stripe,
    });
  } catch (err) {
    res.status(502).json({
      code: "stripe_inspect_failed",
      message: err instanceof Error ? err.message : "Stripe inspect failed.",
    });
  }
});

adminRouter.post("/orders/:id/hold", async (req, res) => {
  const parsed = z
    .object({ hold: z.boolean() })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: "Expected { hold: boolean }." });
    return;
  }
  try {
    const order = await setAdminHold(req.params.id, parsed.data.hold);
    res.json(orderWithListing(order.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      code: (err as Error).message,
      message: "Could not update hold.",
    });
  }
});

adminRouter.post("/orders/:id/force-release", async (req, res) => {
  const parsed = z
    .object({ overrideDispute: z.boolean().optional() })
    .safeParse(req.body ?? {});
  try {
    const order = await adminForceRelease(req.params.id, {
      overrideDispute: parsed.success
        ? Boolean(parsed.data.overrideDispute)
        : false,
    });
    res.json(orderWithListing(order.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "payment_disputed"
          ? "Order is disputed. Pass { overrideDispute: true } after review."
          : code === "seller_payouts_unavailable"
            ? "Seller payouts are not ready."
            : "Could not force-release escrow.",
    });
  }
});

adminRouter.post("/orders/:id/force-refund", async (req, res) => {
  try {
    const order = await adminForceRefund(req.params.id, "admin_refund");
    res.json(orderWithListing(order.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "payment_refund_failed"
          ? "Stripe refund failed."
          : "Could not force-refund escrow.",
    });
  }
});

adminRouter.post("/orders/:id/retry-transfer", async (req, res) => {
  try {
    const order = await retryStuckTransfer(req.params.id);
    res.json(orderWithListing(order.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as Error).message;
    res.status(status).json({
      code,
      message:
        code === "transfer_failed"
          ? "Transfer still failing — check seller Connect status and Stripe."
          : "Could not retry transfer.",
    });
  }
});

/**
 * Resolve a dispute after ops review.
 * - refund: return funds to buyer
 * - release: clear dispute hold and pay seller (requires override)
 * - clear: lift admin hold / restore non-disputed status without money movement
 */
adminRouter.post("/orders/:id/dispute/resolve", async (req, res) => {
  const parsed = z
    .object({
      action: z.enum(["refund", "release", "clear"]),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_body",
      message: 'Expected { action: "refund" | "release" | "clear" }.',
    });
    return;
  }

  const existing = getDb().orders.find(o => o.id === req.params.id);
  if (!existing) {
    res.status(404).json({ code: "not_found", message: "Order not found." });
    return;
  }

  try {
    if (parsed.data.action === "refund") {
      const order = await adminForceRefund(existing.id, "dispute_refund");
      res.json(orderWithListing(order.id));
      return;
    }
    if (parsed.data.action === "release") {
      const order = await adminForceRelease(existing.id, {
        overrideDispute: true,
      });
      await setAdminHold(order.id, false);
      res.json(orderWithListing(order.id));
      return;
    }

    // clear
    await mutateDb(db => {
      const o = db.orders.find(x => x.id === existing.id);
      if (!o) return;
      if (o.paymentStatus === "disputed") {
        const restore = o.paymentStatusBeforeDispute;
        o.paymentStatus =
          restore && restore !== "disputed" ? restore : "captured";
      }
      o.paymentStatusBeforeDispute = null;
      o.adminHold = false;
      o.updatedAt = new Date().toISOString();
    });
    res.json(orderWithListing(existing.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      code: (err as Error).message,
      message: "Could not resolve dispute.",
    });
  }
});

adminRouter.post("/sweeps/run", async (_req, res) => {
  const result = await runAllEscrowSweeps();
  res.json({ ok: true, ...result });
});

/** Dev seed helpers (still require admin key when ADMIN_API_KEY is set). */
adminRouter.post("/reseed", async (_req, res) => {
  if (process.env.ALLOW_RESEED !== "true") {
    res.status(403).json({ code: "forbidden", message: "Reseed disabled." });
    return;
  }
  const db = await resetDb();
  res.json({ ok: true, listings: db.listings.length });
});

adminRouter.post("/clear-except-listings", async (_req, res) => {
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
