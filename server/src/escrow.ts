import { getDb, mutateDb } from "./db.js";
import { refundEscrowPayment, releasePaymentOnPickup } from "./payments.js";
import { fetchRelaiOrderStatus } from "./relai.js";
import type { CompletedReason, Order, PickupVerifiedVia } from "./types.js";

/** Single-process guard against concurrent finalize/refund for the same order. */
const busyOrders = new Set<string>();

async function withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  if (busyOrders.has(orderId)) {
    throw Object.assign(new Error("escrow_busy"), { status: 409 });
  }
  busyOrders.add(orderId);
  try {
    return await fn();
  } finally {
    busyOrders.delete(orderId);
  }
}

/** Hours after drop-off before buyer no-show auto-releases escrow to seller. */
export function pickupNoShowHours(): number {
  const raw = Number(process.env.PICKUP_NO_SHOW_HOURS ?? "72");
  if (!Number.isFinite(raw) || raw < 1) return 72;
  // Stay inside typical card auth capture windows (~7 days).
  return Math.min(Math.floor(raw), 6 * 24);
}

/**
 * Deadline for buyer pickup / escrow auto-release.
 * Prefer Relai access-link expiry; else drop-off time + PICKUP_NO_SHOW_HOURS.
 */
export function resolvePickupDeadline(
  linkExpiresAt: string | null | undefined,
  fromIso: string = new Date().toISOString(),
): string {
  const fallbackMs =
    new Date(fromIso).getTime() + pickupNoShowHours() * 60 * 60 * 1000;
  if (linkExpiresAt) {
    const linkMs = new Date(linkExpiresAt).getTime();
    if (Number.isFinite(linkMs)) {
      // Use the earlier of Relai link expiry and our marketplace cap.
      return new Date(Math.min(linkMs, fallbackMs)).toISOString();
    }
  }
  return new Date(fallbackMs).toISOString();
}

export function isPickupDeadlinePassed(order: Order, now = Date.now()): boolean {
  if (!order.pickupLinkExpiresAt) return false;
  const ms = new Date(order.pickupLinkExpiresAt).getTime();
  return Number.isFinite(ms) && ms <= now;
}

export function findOrderByRelaiOrderId(relaiOrderId: string): Order | undefined {
  return getDb().orders.find(o => o.relaiOrderId === relaiOrderId);
}

/** Record Relai proof of buyer pickup (idempotent). */
export async function markRelaiPickupVerified(
  orderId: string,
  via: PickupVerifiedVia,
  webhookEventId?: string | null,
): Promise<Order> {
  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === orderId);
    if (!order) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (order.relaiPickupVerifiedAt) return;
    const ts = new Date().toISOString();
    order.relaiPickupVerifiedAt = ts;
    order.pickupVerifiedVia = via;
    if (webhookEventId) {
      order.relaiWebhookEventId = webhookEventId;
    }
    order.updatedAt = ts;
  });
  return order!;
}

/**
 * Poll Relai with the server secret key and mark pickup verified when the
 * Relai order is already `completed`. Used by POST /complete as a webhook fallback.
 */
export async function ensurePickupVerifiedFromRelai(order: Order): Promise<Order> {
  if (order.relaiPickupVerifiedAt) return order;
  if (!order.relaiOrderId) {
    throw Object.assign(new Error("relai_order_missing"), { status: 409 });
  }

  let status: "open" | "completed" | "cancelled" | "refunded";
  try {
    status = await fetchRelaiOrderStatus(order.relaiOrderId);
  } catch (err) {
    if (err instanceof Error && err.message === "relai_secret_unconfigured") {
      throw err;
    }
    console.warn(
      `[escrow] Relai order poll failed order=${order.id}`,
      err instanceof Error ? err.message : err,
    );
    throw Object.assign(new Error("relai_status_unavailable"), { status: 502 });
  }

  if (status !== "completed") {
    throw Object.assign(new Error("pickup_not_verified"), { status: 409 });
  }
  return markRelaiPickupVerified(order.id, "poll");
}

export async function finalizeOrderEscrow(
  orderId: string,
  reason: CompletedReason,
): Promise<Order> {
  return withOrderLock(orderId, async () => {
    const existing = getDb().orders.find(o => o.id === orderId);
    if (!existing) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (existing.status === "completed") {
      return existing;
    }
    if (existing.status !== "ready_for_pickup") {
      throw Object.assign(new Error("invalid_status"), { status: 409 });
    }
    if (existing.paymentStatus === "disputed") {
      throw Object.assign(new Error("payment_disputed"), { status: 409 });
    }
    // Buyer pickup must be proven by Relai (webhook or poll). No-show does not.
    if (reason === "pickup" && !existing.relaiPickupVerifiedAt) {
      throw Object.assign(new Error("pickup_not_verified"), { status: 409 });
    }

    const payout = await releasePaymentOnPickup(existing);

    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "completed") return;
      const ts = new Date().toISOString();
      order.status = "completed";
      order.completedReason = reason;
      order.paymentStatus = payout.paymentStatus;
      order.stripeTransferId = payout.stripeTransferId;
      order.updatedAt = ts;
      order.completedAt = ts;
      const listing = db.listings.find(l => l.id === order!.listingId);
      if (listing) {
        listing.status = "sold";
        listing.updatedAt = ts;
      }
    });
    return order!;
  });
}

/**
 * Cancel a ready-for-pickup order and return buyer funds (void auth or refund).
 * Does not reverse a completed/transferred sale — use only before finalize.
 */
export async function refundOrderEscrow(orderId: string): Promise<Order> {
  return withOrderLock(orderId, async () => {
    const existing = getDb().orders.find(o => o.id === orderId);
    if (!existing) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (existing.status === "cancelled") {
      return existing;
    }
    if (existing.status !== "ready_for_pickup") {
      throw Object.assign(new Error("invalid_status"), { status: 409 });
    }
    if (existing.paymentStatus === "disputed") {
      throw Object.assign(new Error("payment_disputed"), { status: 409 });
    }

    const refund = await refundEscrowPayment(existing);

    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "cancelled") return;
      const ts = new Date().toISOString();
      order.status = "cancelled";
      order.paymentStatus = refund.paymentStatus;
      order.stripeRefundId = refund.stripeRefundId;
      order.updatedAt = ts;
      const listing = db.listings.find(l => l.id === order!.listingId);
      if (listing && (listing.status === "reserved" || listing.status === "sold")) {
        listing.status = "available";
        listing.updatedAt = ts;
      }
    });
    return order!;
  });
}

/** Release escrow to sellers when buyers miss the pickup deadline. */
export async function sweepBuyerNoShows(): Promise<{
  checked: number;
  released: number;
  failed: string[];
}> {
  const due = getDb().orders.filter(
    o =>
      o.status === "ready_for_pickup" &&
      o.paymentStatus !== "disputed" &&
      o.pickupLinkExpiresAt &&
      isPickupDeadlinePassed(o),
  );

  let released = 0;
  const failed: string[] = [];

  for (const order of due) {
    try {
      await finalizeOrderEscrow(order.id, "no_show");
      released += 1;
      console.log(
        `[escrow] no-show release order=${order.id} seller=${order.sellerUserId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      failed.push(`${order.id}:${message}`);
      console.warn(`[escrow] no-show failed order=${order.id}: ${message}`);
    }
  }

  return { checked: due.length, released, failed };
}

export function startEscrowScheduler(): void {
  const everyMs = Number(process.env.ESCROW_SWEEP_INTERVAL_MS ?? "60000");
  const interval = Number.isFinite(everyMs) && everyMs >= 15_000 ? everyMs : 60_000;

  const tick = () => {
    void sweepBuyerNoShows().catch(err => {
      console.warn("[escrow] sweep error", err);
    });
  };

  tick();
  setInterval(tick, interval);
  console.log(
    `[escrow] no-show sweep every ${Math.round(interval / 1000)}s; deadline default ${pickupNoShowHours()}h after drop-off`,
  );
}
