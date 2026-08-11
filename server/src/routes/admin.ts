import { Router } from "express";
import { z } from "zod";

import { requireAdmin } from "../adminAuth.js";
import { getDb, mutateDb, refreshDb, resetDb } from "../db.js";
import {
  adminForceRefund,
  adminForceRelease,
  listEscrowAttentionOrders,
  runAllEscrowSweeps,
  retryStuckTransfer,
  setAdminHold,
} from "../escrow.js";
import { inspectOrderStripe } from "../payments.js";
import {
  buildPantryReport,
  getPantrySettings,
  getPatronAllocation,
  pantryReportToCsv,
  updatePantrySettings,
} from "../pantry.js";
import { SEED_SELLER_USER_ID } from "../seed.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/pantry", (_req, res) => {
  res.json(getPantrySettings());
});

adminRouter.put("/pantry", async (req, res) => {
  const parsed = z
    .object({
      enabled: z.boolean().optional(),
      defaultPatronCap: z.number().int().min(1).max(50).optional(),
      basketHoldTtlMinutes: z.number().int().min(0).max(24 * 60).optional(),
      lowStockThreshold: z.number().int().min(0).max(100).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }
  const settings = await updatePantrySettings(parsed.data);
  res.json(settings);
});

adminRouter.put("/patrons/:userId/cap", async (req, res) => {
  const parsed = z
    .object({
      patronCap: z.number().int().min(1).max(50).nullable(),
      isPantrySeller: z.boolean().optional(),
      pantryBlocked: z.boolean().optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }
  const userId = String(req.params.userId ?? "");
  let profile = getDb().profiles.find(p => p.userId === userId);
  if (!profile) {
    res.status(404).json({ code: "not_found", message: "Profile not found." });
    return;
  }
  await mutateDb(db => {
    const p = db.profiles.find(x => x.userId === userId)!;
    if (parsed.data.patronCap !== undefined) p.patronCap = parsed.data.patronCap;
    if (parsed.data.isPantrySeller !== undefined) {
      p.isPantrySeller = parsed.data.isPantrySeller;
    }
    if (parsed.data.pantryBlocked !== undefined) {
      p.pantryBlocked = parsed.data.pantryBlocked;
    }
    p.updatedAt = new Date().toISOString();
    profile = p;
  });
  res.json({
    profile,
    allocation: getPatronAllocation(userId),
  });
});

adminRouter.get("/patrons", async (_req, res) => {
  await refreshDb();
  const db = getDb();
  const patrons = db.profiles
    .filter(p => p.roles.includes("buyer") || p.roles.includes("seller"))
    .map(p => {
      const userOrders = db.orders.filter(
        o => o.buyerUserId === p.userId || o.sellerUserId === p.userId,
      );
      const asBuyer = userOrders.filter(o => o.buyerUserId === p.userId);
      const asSeller = userOrders.filter(o => o.sellerUserId === p.userId);
      const openStatuses = new Set([
        "pending_accept",
        "accepted",
        "ready_for_pickup",
      ]);
      const lastOrderAt =
        userOrders
          .map(o => o.updatedAt || o.createdAt)
          .sort()
          .at(-1) ?? null;
      return {
        ...p,
        allocation: getPatronAllocation(p.userId),
        activity: {
          ordersAsBuyer: asBuyer.length,
          ordersAsSeller: asSeller.length,
          openAsBuyer: asBuyer.filter(o => openStatuses.has(o.status)).length,
          completedAsBuyer: asBuyer.filter(o => o.status === "completed").length,
          lastOrderAt,
        },
      };
    })
    .sort((a, b) => {
      const an = (a.name || a.email || a.userId).toLowerCase();
      const bn = (b.name || b.email || b.userId).toLowerCase();
      return an.localeCompare(bn);
    });
  res.json({ count: patrons.length, data: patrons });
});

adminRouter.get("/pantry/report", async (_req, res) => {
  await refreshDb();
  res.json(buildPantryReport());
});

adminRouter.get("/pantry/report.csv", async (_req, res) => {
  await refreshDb();
  const csv = pantryReportToCsv(buildPantryReport());
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="pantry-report.csv"',
  );
  res.send(csv);
});

function orderWithListing(orderId: string) {
  const order = getDb().orders.find(o => o.id === orderId);
  if (!order) return null;
  const items = (order.items?.length
    ? order.items
    : [{ listingId: order.listingId, quantity: 1, title: "Item" }]
  ).map(line => ({
    ...line,
    listing: getDb().listings.find(l => l.id === line.listingId) ?? null,
  }));
  return {
    ...order,
    items,
    listing: getDb().listings.find(l => l.id === order.listingId) ?? null,
  };
}

/** List orders needing ops attention (stuck / disputed / frozen / overdue). */
adminRouter.get("/orders/escrow", async (req, res) => {
  await refreshDb();
  const filter =
    typeof req.query.filter === "string" ? req.query.filter : "attention";
  const data = listEscrowAttentionOrders(filter).map(o =>
    orderWithListing(o.id)!,
  );
  res.json({ filter, count: data.length, data });
});

/**
 * All marketplace orders for ops history (optional status filter).
 * Use filter=all or omit status for every order.
 */
adminRouter.get("/orders", async (req, res) => {
  await refreshDb();
  const status =
    typeof req.query.status === "string" ? req.query.status.trim() : "all";
  let orders = [...getDb().orders];
  if (status && status !== "all") {
    orders = orders.filter(o => o.status === status);
  }
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const data = orders.map(o => orderWithListing(o.id)!);
  res.json({ status, count: data.length, data });
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
      o.platformDisputeReason = null;
      o.platformDisputeOpenedBy = null;
      o.platformDisputeOpenedAt = null;
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
