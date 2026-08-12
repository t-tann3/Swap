import { getDb, mutateDb } from "./db.js";
import { log } from "./logger.js";
import {
  markListingUnitCompleted,
  orderLineItems,
  releaseListingUnits,
  sweepAbandonedBaskets,
} from "./pantry.js";
import {
  cancelAuthorizedPayment,
  refreshSellerPayoutReadiness,
  refundEscrowPayment,
  releasePaymentOnPickup,
} from "./payments.js";
import { notifyOrderPickedUp } from "./push.js";
import { fetchRelaiOrderStatus } from "./relai.js";
import type {
  CancelledReason,
  CompletedReason,
  DisputeStatus,
  Order,
  PickupVerifiedVia,
} from "./types.js";

function finalizeListingsForOrder(
  db: { listings: import("./types.js").Listing[] },
  order: Order,
  ts: string,
): void {
  const seen = new Set<string>();
  for (const line of orderLineItems(order)) {
    if (seen.has(line.listingId)) continue;
    seen.add(line.listingId);
    const listing = db.listings.find(l => l.id === line.listingId);
    if (listing) markListingUnitCompleted(listing, ts);
  }
}

function restoreListingsForOrder(
  db: { listings: import("./types.js").Listing[] },
  order: Order,
  ts: string,
): void {
  for (const line of orderLineItems(order)) {
    const listing = db.listings.find(l => l.id === line.listingId);
    if (listing) releaseListingUnits(listing, line.quantity, ts);
  }
}

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
    log.warn("escrow_relai_poll_failed", {
      orderId: order.id,
      errMessage: err instanceof Error ? err.message : String(err),
    });
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
      // Allow retrying a stuck capture→transfer after a prior partial finalize,
      // or paying out a credit once the seller finishes payout setup.
      if (
        (existing.paymentStatus === "captured" ||
          existing.paymentStatus === "credited") &&
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
    let justCompleted = false;
    await mutateDb(db => {
      order = db.orders.find(o => o.id === orderId)!;
      if (order.status === "completed" && order.stripeTransferId) return;
      const ts = new Date().toISOString();
      justCompleted = true;
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
      finalizeListingsForOrder(db, order, ts);
    });
    // Only a real neighbor pickup notifies the pantry (not no-show / admin release).
    if (justCompleted && reason === "pickup") {
      notifyOrderPickedUp(order!);
    }
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
      restoreListingsForOrder(db, order, ts);
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
      restoreListingsForOrder(db, order, ts);
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

  // Completed but money still recoverable (captured stuck, credited, or transferred).
  if (
    existing.status === "completed" &&
    (existing.paymentStatus === "captured" ||
      existing.paymentStatus === "credited" ||
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
        restoreListingsForOrder(db, order, ts);
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
    // Stuck capture (with or without completed marketplace status), a credit
    // awaiting payout setup, or an auth still to capture.
    if (
      existing.paymentStatus !== "captured" &&
      existing.paymentStatus !== "credited" &&
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

function creditedOrdersFor(sellerUserId: string): Order[] {
  return getDb().orders.filter(
    o =>
      o.sellerUserId === sellerUserId &&
      o.paymentStatus === "credited" &&
      !o.stripeTransferId &&
      !o.adminHold,
  );
}

/**
 * Pay out everything a seller earned before they finished payout setup.
 * Safe to call repeatedly: orders that cannot transfer yet stay credited.
 */
export async function settleSellerCredits(sellerUserId: string): Promise<{
  settled: number;
  pending: number;
}> {
  const due = creditedOrdersFor(sellerUserId);
  if (due.length === 0) return { settled: 0, pending: 0 };

  let settled = 0;
  for (const order of due) {
    try {
      await retryStuckTransfer(order.id);
      const latest = getDb().orders.find(o => o.id === order.id);
      if (latest?.stripeTransferId) settled += 1;
    } catch (err) {
      log.warn("escrow_credit_settle_failed", {
        orderId: order.id,
        sellerUserId,
        errMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (settled > 0) {
    log.info("escrow_credits_settled", { sellerUserId, settled });
  }
  return { settled, pending: creditedOrdersFor(sellerUserId).length };
}

/** Pay out held credits for sellers who have since connected a bank account. */
export async function sweepSellerCredits(): Promise<{
  checked: number;
  settled: number;
  sellersPending: number;
}> {
  const sellerIds = [
    ...new Set(
      getDb()
        .orders.filter(o => o.paymentStatus === "credited" && !o.adminHold)
        .map(o => o.sellerUserId),
    ),
  ];

  let settled = 0;
  let sellersPending = 0;
  for (const sellerUserId of sellerIds) {
    // One readiness probe per seller — skip entirely while they cannot be paid.
    const ready = await refreshSellerPayoutReadiness(sellerUserId).catch(
      () => false,
    );
    if (!ready) {
      sellersPending += 1;
      continue;
    }
    const result = await settleSellerCredits(sellerUserId);
    settled += result.settled;
    if (result.pending > 0) sellersPending += 1;
  }

  return { checked: sellerIds.length, settled, sellersPending };
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
    o.paymentStatus === "disputed" ||
    Boolean(o.stripeDisputeId) ||
    Boolean(o.platformDisputeOpenedAt);

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
      log.info("escrow_no_show_release", {
        orderId: order.id,
        sellerUserId: order.sellerUserId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      failed.push(`${order.id}:${message}`);
      log.warn("escrow_no_show_failed", { orderId: order.id, errMessage: message });
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
      log.info("escrow_seller_timeout", { orderId: order.id, reason });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      failed.push(`${order.id}:${message}`);
      log.warn("escrow_seller_timeout_failed", {
        orderId: order.id,
        errMessage: message,
      });
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
      log.warn("escrow_stuck_transfer_failed", {
        orderId: order.id,
        errMessage: message,
      });
    }
  }

  return { checked: due.length, repaired, failed };
}

export async function runAllEscrowSweeps(): Promise<{
  noShow: Awaited<ReturnType<typeof sweepBuyerNoShows>>;
  sellerTimeout: Awaited<ReturnType<typeof sweepSellerTimeouts>>;
  stuckTransfer: Awaited<ReturnType<typeof sweepStuckTransfers>>;
  sellerCredits: Awaited<ReturnType<typeof sweepSellerCredits>>;
  abandonedBaskets: Awaited<ReturnType<typeof sweepAbandonedBaskets>>;
}> {
  const noShow = await sweepBuyerNoShows();
  const sellerTimeout = await sweepSellerTimeouts();
  const stuckTransfer = await sweepStuckTransfers();
  const sellerCredits = await sweepSellerCredits();
  const abandonedBaskets = await sweepAbandonedBaskets();
  return {
    noShow,
    sellerTimeout,
    stuckTransfer,
    sellerCredits,
    abandonedBaskets,
  };
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

/**
 * Buyer/seller opens a platform dispute while the item may be in a locker.
 * Freezes auto escrow; admin resolves via force-refund / force-release.
 */
export async function openPlatformDispute(
  orderId: string,
  openedByUserId: string,
  reason: string,
): Promise<Order> {
  const trimmed = reason.trim();
  if (trimmed.length < 8) {
    throw Object.assign(new Error("invalid_reason"), { status: 400 });
  }

  const existing = getDb().orders.find(o => o.id === orderId);
  if (!existing) {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }
  if (
    existing.buyerUserId !== openedByUserId &&
    existing.sellerUserId !== openedByUserId
  ) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  if (
    existing.status !== "ready_for_pickup" &&
    existing.status !== "completed" &&
    existing.status !== "accepted"
  ) {
    throw Object.assign(new Error("invalid_status"), { status: 409 });
  }
  if (
    existing.platformDisputeOpenedAt ||
    existing.paymentStatus === "disputed"
  ) {
    throw Object.assign(new Error("dispute_already_open"), { status: 409 });
  }

  let order: Order | undefined;
  await mutateDb(db => {
    order = db.orders.find(o => o.id === orderId);
    if (!order) {
      throw Object.assign(new Error("not_found"), { status: 404 });
    }
    const ts = new Date().toISOString();
    order.platformDisputeReason = trimmed.slice(0, 1000);
    order.platformDisputeOpenedBy = openedByUserId;
    order.platformDisputeOpenedAt = ts;
    order.adminHold = true;
    order.updatedAt = ts;
  });

  log.info("platform_dispute_opened", {
    orderId,
    openedByUserId,
  });
  return order!;
}

export function startEscrowScheduler(): void {
  const everyMs = Number(process.env.ESCROW_SWEEP_INTERVAL_MS ?? "60000");
  const interval = Number.isFinite(everyMs) && everyMs >= 15_000 ? everyMs : 60_000;

  const tick = () => {
    void runAllEscrowSweeps().catch(err => {
      log.warn("escrow_sweep_error", {
        errMessage: err instanceof Error ? err.message : String(err),
      });
    });
  };

  tick();
  setInterval(tick, interval);
  log.info("escrow_scheduler_started", {
    intervalSec: Math.round(interval / 1000),
    acceptHours: sellerAcceptHours(),
    dropOffHours: sellerDropOffHours(),
    noShowHours: pickupNoShowHours(),
  });
}
