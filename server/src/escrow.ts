import { getDb, mutateDb } from "./db.js";
import {
  cancelAuthorizedPayment,
  refundEscrowPayment,
  releasePaymentOnPickup,
} from "./payments.js";
import { fetchRelaiOrderStatus } from "./relai.js";
import type {
  CancelledReason,
  CompletedReason,
  DisputeStatus,
  Order,
  PickupVerifiedVia,
} from "./types.js";

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

function hoursEnv(name: string, fallback: number, max: number): number {
  const raw = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(Math.floor(raw), max);
}

/** Hours after drop-off before buyer no-show auto-releases escrow to seller. */
export function pickupNoShowHours(): number {
  return hoursEnv("PICKUP_NO_SHOW_HOURS", 72, 6 * 24);
}

/** Hours after buy before seller-accept timeout voids the auth. */
export function sellerAcceptHours(): number {
  return hoursEnv("SELLER_ACCEPT_HOURS", 24, 6 * 24);
}

/** Hours after accept before seller-drop-off timeout voids the auth. */
export function sellerDropOffHours(): number {
  return hoursEnv("SELLER_DROP_OFF_HOURS", 48, 6 * 24);
}

export function deadlineFromNow(hours: number, fromIso = new Date().toISOString()): string {
  return new Date(new Date(fromIso).getTime() + hours * 60 * 60 * 1000).toISOString();
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
      return new Date(Math.min(linkMs, fallbackMs)).toISOString();
    }
  }
  return new Date(fallbackMs).toISOString();
}

export function isDeadlinePassed(
  iso: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms <= now;
}

export function isPickupDeadlinePassed(order: Order, now = Date.now()): boolean {
  return isDeadlinePassed(order.pickupLinkExpiresAt, now);
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
  options: { skipRelaiProof?: boolean; allowDisputed?: boolean } = {},
): Promise<Order> {
  return withOrderLock(orderId, async () => {
    const existing = getDb().orders.find(o => o.id === orderId);
    if (!existing) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (existing.status === "completed") {
      // Allow retrying a stuck capture→transfer after a prior partial finalize.
      if (
        existing.paymentStatus === "captured" &&
        !existing.stripeTransferId &&
        !existing.adminHold
      ) {
        const payout = await releasePaymentOnPickup(existing);
        let order: Order | undefined;
        await mutateDb(db => {
          order = db.orders.find(o => o.id === orderId)!;
          order.paymentStatus = payout.paymentStatus;
          order.stripeTransferId = payout.stripeTransferId;
          order.transferLastError =
            payout.paymentStatus === "transferred" ? null : order.transferLastError;
          order.updatedAt = new Date().toISOString();
        });
        return order!;
      }
      return existing;
    }
    if (existing.status !== "ready_for_pickup") {
      throw Object.assign(new Error("invalid_status"), { status: 409 });
    }
    if (existing.paymentStatus === "disputed" && !options.allowDisputed) {
      throw Object.assign(new Error("payment_disputed"), { status: 409 });
    }
    if (
      reason === "pickup" &&
      !existing.relaiPickupVerifiedAt &&
      !options.skipRelaiProof
    ) {
      throw Object.assign(new Error("pickup_not_verified"), { status: 409 });
    }

    const payout = await releasePaymentOnPickup(existing);

    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "completed" && order.stripeTransferId) return;
      const ts = new Date().toISOString();
      order.status = "completed";
      order.completedReason = reason;
      order.cancelledReason = null;
      order.paymentStatus = payout.paymentStatus;
      order.stripeTransferId = payout.stripeTransferId;
      if (payout.paymentStatus === "transferred") {
        order.transferLastError = null;
      }
      order.updatedAt = ts;
      order.completedAt = order.completedAt ?? ts;
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
export async function refundOrderEscrow(
  orderId: string,
  cancelledReason: CancelledReason = "post_dropoff_refund",
  options: { allowDisputed?: boolean } = {},
): Promise<Order> {
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
    if (existing.paymentStatus === "disputed" && !options.allowDisputed) {
      throw Object.assign(new Error("payment_disputed"), { status: 409 });
    }

    const refund = await refundEscrowPayment(existing);

    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "cancelled") return;
      const ts = new Date().toISOString();
      order.status = "cancelled";
      order.cancelledReason = cancelledReason;
      order.paymentStatus = refund.paymentStatus;
      order.stripeRefundId = refund.stripeRefundId;
      order.adminHold = false;
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

/**
 * Void authorized payment for pre-drop-off orders (pending_accept / accepted).
 * Used by seller-timeout sweeps and admin force-refund before drop-off.
 */
export async function voidPreDropoffEscrow(
  orderId: string,
  cancelledReason: CancelledReason,
): Promise<Order> {
  return withOrderLock(orderId, async () => {
    const existing = getDb().orders.find(o => o.id === orderId);
    if (!existing) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (existing.status === "cancelled") return existing;
    if (
      existing.status !== "pending_accept" &&
      existing.status !== "accepted"
    ) {
      throw Object.assign(new Error("invalid_status"), { status: 409 });
    }

    await cancelAuthorizedPayment(existing.stripePaymentIntentId);

    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "cancelled") return;
      const ts = new Date().toISOString();
      order.status = "cancelled";
      order.cancelledReason = cancelledReason;
      order.paymentStatus =
        order.paymentStatus === "authorized" || order.paymentStatus === "none"
          ? "cancelled"
          : order.paymentStatus;
      order.adminHold = false;
      order.updatedAt = ts;
      const listing = db.listings.find(l => l.id === order!.listingId);
      if (listing && listing.status === "reserved") {
        listing.status = "available";
        listing.updatedAt = ts;
      }
    });
    return order!;
  });
}

/** Admin/ops: release escrow without Relai proof (optionally clearing dispute). */
export async function adminForceRelease(
  orderId: string,
  options: { overrideDispute?: boolean } = {},
): Promise<Order> {
  const existing = getDb().orders.find(o => o.id === orderId);
  if (!existing) {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }

  if (options.overrideDispute && existing.paymentStatus === "disputed") {
    await clearDisputeForRelease(orderId);
  }

  return finalizeOrderEscrow(orderId, "admin_release", {
    skipRelaiProof: true,
    allowDisputed: Boolean(options.overrideDispute),
  });
}

/** Admin/ops: refund buyer funds from almost any non-terminal money state. */
export async function adminForceRefund(
  orderId: string,
  cancelledReason: CancelledReason = "admin_refund",
): Promise<Order> {
  const existing = getDb().orders.find(o => o.id === orderId);
  if (!existing) {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }

  if (
    existing.status === "pending_accept" ||
    existing.status === "accepted"
  ) {
    return voidPreDropoffEscrow(orderId, cancelledReason);
  }

  if (existing.status === "ready_for_pickup") {
    return refundOrderEscrow(orderId, cancelledReason, { allowDisputed: true });
  }

  // Completed but money still recoverable (captured stuck, or transferred).
  if (
    existing.status === "completed" &&
    (existing.paymentStatus === "captured" ||
      existing.paymentStatus === "transferred" ||
      existing.paymentStatus === "disputed" ||
      existing.paymentStatus === "authorized")
  ) {
    return withOrderLock(orderId, async () => {
      const latest = getDb().orders.find(o => o.id === orderId)!;
      const refund = await refundEscrowPayment(latest);
      let order: Order | undefined;
      await mutateDb(db => {
        order = db.orders.find(o => o.id === orderId)!;
        const ts = new Date().toISOString();
        order.status = "cancelled";
        order.cancelledReason = cancelledReason;
        order.completedReason = null;
        order.paymentStatus = refund.paymentStatus;
        order.stripeRefundId = refund.stripeRefundId;
        order.adminHold = false;
        order.disputeStatus =
          order.disputeStatus && order.paymentStatus === "disputed"
            ? order.disputeStatus
            : order.disputeStatus;
        if (refund.paymentStatus === "refunded" || refund.paymentStatus === "cancelled") {
          // Dispute resolved via refund.
          if (order.stripeDisputeId) {
            order.paymentStatusBeforeDispute = null;
          }
        }
        order.updatedAt = ts;
        const listing = db.listings.find(l => l.id === order!.listingId);
        if (listing && (listing.status === "sold" || listing.status === "reserved")) {
          listing.status = "available";
          listing.updatedAt = ts;
        }
      });
      return order!;
    });
  }

  throw Object.assign(new Error("invalid_status"), { status: 409 });
}

async function clearDisputeForRelease(orderId: string): Promise<void> {
  await mutateDb(db => {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    const restore = o.paymentStatusBeforeDispute;
    if (o.paymentStatus === "disputed") {
      o.paymentStatus =
        restore && restore !== "disputed" ? restore : "captured";
    }
    o.paymentStatusBeforeDispute = null;
    o.updatedAt = new Date().toISOString();
  });
}

export async function applyDisputeOpened(
  orderId: string,
  disputeId: string,
  status: DisputeStatus,
): Promise<void> {
  await mutateDb(db => {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    if (o.paymentStatus !== "disputed") {
      o.paymentStatusBeforeDispute = o.paymentStatus;
    }
    o.paymentStatus = "disputed";
    o.stripeDisputeId = disputeId;
    o.disputeStatus = status;
    o.adminHold = true;
    o.updatedAt = new Date().toISOString();
  });
}

export async function applyDisputeClosed(
  orderId: string,
  status: DisputeStatus,
): Promise<void> {
  await mutateDb(db => {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    o.disputeStatus = status;
    o.updatedAt = new Date().toISOString();
    if (status === "won" || status === "warning_closed") {
      const restore = o.paymentStatusBeforeDispute;
      if (o.paymentStatus === "disputed") {
        o.paymentStatus =
          restore && restore !== "disputed" ? restore : "captured";
      }
      o.paymentStatusBeforeDispute = null;
      // Keep adminHold so ops explicitly release or clear hold.
    } else if (status === "lost" || status === "charge_refunded") {
      // Funds typically already pulled by Stripe — mark refunded for ledger clarity.
      o.paymentStatus = "refunded";
      o.paymentStatusBeforeDispute = null;
    }
  });
}

export async function setAdminHold(orderId: string, hold: boolean): Promise<Order> {
  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === orderId);
    if (!order) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    order.adminHold = hold;
    order.updatedAt = new Date().toISOString();
  });
  return order!;
}

export async function retryStuckTransfer(orderId: string): Promise<Order> {
  return withOrderLock(orderId, async () => {
    const existing = getDb().orders.find(o => o.id === orderId);
    if (!existing) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    if (existing.paymentStatus === "disputed") {
      throw Object.assign(new Error("payment_disputed"), { status: 409 });
    }
    if (existing.stripeTransferId || existing.paymentStatus === "transferred") {
      return existing;
    }
    // Stuck capture (with or without completed marketplace status), or auth still to capture.
    if (
      existing.paymentStatus !== "captured" &&
      existing.paymentStatus !== "authorized"
    ) {
      throw Object.assign(new Error("invalid_status"), { status: 409 });
    }

    const payout = await releasePaymentOnPickup(existing);
    let order: Order | undefined;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      order.paymentStatus = payout.paymentStatus;
      order.stripeTransferId = payout.stripeTransferId;
      if (payout.paymentStatus === "transferred") {
        order.transferLastError = null;
      }
      order.updatedAt = new Date().toISOString();
    });
    return order!;
  });
}

export function listEscrowAttentionOrders(filter?: string): Order[] {
  const orders = getDb().orders;
  const now = Date.now();

  const stuck = (o: Order) =>
    Boolean(
      (o.paymentStatus === "captured" && !o.stripeTransferId) ||
        o.transferLastError,
    );

  const disputed = (o: Order) =>
    o.paymentStatus === "disputed" || Boolean(o.stripeDisputeId);

  const frozen = (o: Order) => o.adminHold;

  const overdue = (o: Order) =>
    !o.adminHold &&
    ((o.status === "pending_accept" &&
      isDeadlinePassed(o.sellerAcceptDeadlineAt, now)) ||
      (o.status === "accepted" &&
        isDeadlinePassed(o.sellerDropOffDeadlineAt, now)) ||
      (o.status === "ready_for_pickup" && isPickupDeadlinePassed(o, now)));

  switch (filter) {
    case "stuck":
      return orders.filter(stuck);
    case "disputed":
      return orders.filter(disputed);
    case "frozen":
      return orders.filter(frozen);
    case "overdue":
      return orders.filter(overdue);
    case "attention":
    default:
      return orders.filter(
        o => stuck(o) || disputed(o) || frozen(o) || overdue(o),
      );
  }
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
      !o.adminHold &&
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

/** Void auth when sellers never accept or never drop off. */
export async function sweepSellerTimeouts(): Promise<{
  checked: number;
  voided: number;
  failed: string[];
}> {
  const now = Date.now();
  const due = getDb().orders.filter(
    o =>
      !o.adminHold &&
      o.paymentStatus !== "disputed" &&
      ((o.status === "pending_accept" &&
        isDeadlinePassed(o.sellerAcceptDeadlineAt, now)) ||
        (o.status === "accepted" &&
          isDeadlinePassed(o.sellerDropOffDeadlineAt, now))),
  );

  let voided = 0;
  const failed: string[] = [];

  for (const order of due) {
    const reason: CancelledReason =
      order.status === "pending_accept"
        ? "seller_timeout_accept"
        : "seller_timeout_dropoff";
    try {
      await voidPreDropoffEscrow(order.id, reason);
      voided += 1;
      console.log(`[escrow] seller-timeout ${reason} order=${order.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      failed.push(`${order.id}:${message}`);
      console.warn(
        `[escrow] seller-timeout failed order=${order.id}: ${message}`,
      );
    }
  }

  return { checked: due.length, voided, failed };
}

/** Retry Connect transfers for captured-but-not-transferred orders. */
export async function sweepStuckTransfers(): Promise<{
  checked: number;
  repaired: number;
  failed: string[];
}> {
  const due = getDb().orders.filter(
    o =>
      !o.adminHold &&
      o.paymentStatus !== "disputed" &&
      o.paymentStatus === "captured" &&
      !o.stripeTransferId,
  );

  let repaired = 0;
  const failed: string[] = [];

  for (const order of due) {
    try {
      await retryStuckTransfer(order.id);
      const latest = getDb().orders.find(o => o.id === order.id);
      if (latest?.stripeTransferId) repaired += 1;
      else failed.push(`${order.id}:still_stuck`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      failed.push(`${order.id}:${message}`);
      console.warn(
        `[escrow] stuck-transfer retry failed order=${order.id}: ${message}`,
      );
    }
  }

  return { checked: due.length, repaired, failed };
}

export async function runAllEscrowSweeps(): Promise<{
  noShow: Awaited<ReturnType<typeof sweepBuyerNoShows>>;
  sellerTimeout: Awaited<ReturnType<typeof sweepSellerTimeouts>>;
  stuckTransfer: Awaited<ReturnType<typeof sweepStuckTransfers>>;
}> {
  const noShow = await sweepBuyerNoShows();
  const sellerTimeout = await sweepSellerTimeouts();
  const stuckTransfer = await sweepStuckTransfers();
  return { noShow, sellerTimeout, stuckTransfer };
}

export function mapStripeDisputeStatus(status: string): DisputeStatus {
  const allowed: DisputeStatus[] = [
    "needs_response",
    "under_review",
    "won",
    "lost",
    "warning_closed",
    "charge_refunded",
    "warning_needs_response",
    "warning_under_review",
  ];
  if (allowed.includes(status as DisputeStatus)) {
    return status as DisputeStatus;
  }
  return "under_review";
}

export function startEscrowScheduler(): void {
  const everyMs = Number(process.env.ESCROW_SWEEP_INTERVAL_MS ?? "60000");
  const interval = Number.isFinite(everyMs) && everyMs >= 15_000 ? everyMs : 60_000;

  const tick = () => {
    void runAllEscrowSweeps().catch(err => {
      console.warn("[escrow] sweep error", err);
    });
  };

  tick();
  setInterval(tick, interval);
  console.log(
    `[escrow] sweeps every ${Math.round(interval / 1000)}s; ` +
      `accept ${sellerAcceptHours()}h, drop-off ${sellerDropOffHours()}h, ` +
      `no-show ${pickupNoShowHours()}h`,
  );
}
