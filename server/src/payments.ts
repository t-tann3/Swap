import type Stripe from "stripe";

import { getDb, mutateDb } from "./db.js";
import { SEED_SELLER_USER_ID } from "./seed.js";
import {
  getStripe,
  paymentsEnabled,
  sellerTransferCents,
} from "./stripe.js";
import type { Order, PaymentStatus, Profile } from "./types.js";

export async function ensureSellerConnectAccount(
  profile: Profile,
): Promise<{ accountId: string; created: boolean }> {
  const stripe = getStripe();
  if (profile.stripeAccountId) {
    return { accountId: profile.stripeAccountId, created: false };
  }

  const account = await stripe.v2.core.accounts.create({
    contact_email: profile.email ?? undefined,
    display_name: profile.name || profile.email || "Swap seller",
    dashboard: "express",
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    identity: {
      country: "us",
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
    include: ["configuration.recipient", "identity", "requirements"],
    metadata: {
      swap_user_id: profile.userId,
    },
  });

  await mutateDb(db => {
    const p = db.profiles.find(x => x.userId === profile.userId);
    if (p) {
      p.stripeAccountId = account.id;
      p.stripePayoutsReady = false;
      p.updatedAt = new Date().toISOString();
    }
  });

  return { accountId: account.id, created: true };
}

export async function refreshSellerPayoutReadiness(
  userId: string,
): Promise<boolean> {
  if (!paymentsEnabled()) return true;
  const profile = getDb().profiles.find(p => p.userId === userId);
  if (!profile?.stripeAccountId) return false;

  const stripe = getStripe();
  const account = await stripe.v2.core.accounts.retrieve(profile.stripeAccountId, {
    include: ["configuration.recipient"],
  });
  const status =
    account.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status;
  const ready = status === "active";

  await mutateDb(db => {
    const p = db.profiles.find(x => x.userId === userId);
    if (p) {
      p.stripePayoutsReady = ready;
      p.updatedAt = new Date().toISOString();
    }
  });
  return ready;
}

/** Sync Connect readiness from a Stripe account id (webhook path). */
export async function refreshPayoutReadinessByAccountId(
  stripeAccountId: string,
): Promise<boolean | null> {
  const profile = getDb().profiles.find(p => p.stripeAccountId === stripeAccountId);
  if (!profile) return null;
  return refreshSellerPayoutReadiness(profile.userId);
}

export async function createListingPaymentIntent(input: {
  listingId: string;
  buyerUserId: string;
  sellerUserId: string;
  priceCents: number;
  title: string;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  const transferGroup = `listing_${input.listingId}_${Date.now().toString(36)}`;

  return stripe.paymentIntents.create({
    amount: input.priceCents,
    currency: "usd",
    capture_method: "manual",
    // Omit payment_method_types → dynamic payment methods.
    transfer_group: transferGroup,
    metadata: {
      listing_id: input.listingId,
      buyer_user_id: input.buyerUserId,
      seller_user_id: input.sellerUserId,
      title: input.title.slice(0, 200),
    },
    description: `Swap: ${input.title}`.slice(0, 500),
  });
}

export async function assertAuthorizedPayment(input: {
  paymentIntentId: string;
  buyerUserId: string;
  listingId: string;
  priceCents: number;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(input.paymentIntentId);

  if (pi.metadata.buyer_user_id !== input.buyerUserId) {
    throw Object.assign(new Error("payment_buyer_mismatch"), { status: 403 });
  }
  if (pi.metadata.listing_id !== input.listingId) {
    throw Object.assign(new Error("payment_listing_mismatch"), { status: 400 });
  }
  if (pi.amount !== input.priceCents) {
    throw Object.assign(new Error("payment_amount_mismatch"), { status: 400 });
  }
  if (pi.status !== "requires_capture") {
    throw Object.assign(new Error("payment_not_authorized"), { status: 400 });
  }
  return pi;
}

export async function cancelAuthorizedPayment(
  paymentIntentId: string | null,
): Promise<void> {
  if (!paymentIntentId || !paymentsEnabled()) return;
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status === "requires_capture" || pi.status === "requires_confirmation") {
    await stripe.paymentIntents.cancel(paymentIntentId, undefined, {
      idempotencyKey: `pi_cancel_${paymentIntentId}`,
    });
  } else if (pi.status === "succeeded") {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `pi_refund_${paymentIntentId}` },
    );
  }
}

function chargeIdFromPi(pi: Stripe.PaymentIntent): string | undefined {
  if (typeof pi.latest_charge === "string") return pi.latest_charge;
  return pi.latest_charge?.id;
}

/**
 * Connect destination for a seller, or null when they cannot receive money yet.
 * Selling never requires Stripe onboarding — an unonboarded seller's share is
 * held on the platform balance as a credit instead.
 */
async function sellerPayoutDestination(sellerId: string): Promise<string | null> {
  if (sellerId === SEED_SELLER_USER_ID) return null;
  if (!getDb().profiles.find(p => p.userId === sellerId)?.stripeAccountId) {
    return null;
  }
  const ready = await refreshSellerPayoutReadiness(sellerId);
  if (!ready) return null;
  // Re-read: the readiness probe writes, which swaps the in-memory db object.
  return (
    getDb().profiles.find(p => p.userId === sellerId)?.stripeAccountId ?? null
  );
}

/** Seller share still held on the platform balance, awaiting payout setup. */
export function sellerCreditedCents(sellerUserId: string): number {
  return getDb()
    .orders.filter(
      o => o.sellerUserId === sellerUserId && o.paymentStatus === "credited",
    )
    .reduce(
      (sum, o) => sum + sellerTransferCents(o.priceCents).transferCents,
      0,
    );
}

export function findProfileByStripeAccountId(
  stripeAccountId: string,
): Profile | undefined {
  return getDb().profiles.find(p => p.stripeAccountId === stripeAccountId);
}

/**
 * Capture platform PaymentIntent (if needed) then transfer the seller share.
 * Capture is never gated on Connect onboarding: buyers have already been
 * promised the handoff, so funds are taken and the share is credited to the
 * seller when they cannot be paid yet. Capture + transfer use idempotency keys.
 */
export async function releasePaymentOnPickup(order: Order): Promise<{
  paymentStatus: PaymentStatus;
  stripeTransferId: string | null;
}> {
  if (!paymentsEnabled() || !order.stripePaymentIntentId) {
    return { paymentStatus: "none", stripeTransferId: null };
  }

  // Fresh row — concurrent finalize / webhook may have already paid out.
  const latest = getDb().orders.find(o => o.id === order.id) ?? order;
  if (latest.paymentStatus === "disputed") {
    throw Object.assign(new Error("payment_disputed"), { status: 409 });
  }
  if (latest.stripeTransferId || latest.paymentStatus === "transferred") {
    return {
      paymentStatus: "transferred",
      stripeTransferId: latest.stripeTransferId,
    };
  }

  const sellerId = latest.sellerUserId;
  const stripe = getStripe();
  const piId = latest.stripePaymentIntentId!;
  let pi = await stripe.paymentIntents.retrieve(piId);

  if (pi.status === "requires_capture") {
    pi = await stripe.paymentIntents.capture(
      piId,
      {},
      { idempotencyKey: `capture_${latest.id}_${piId}` },
    );
  }
  if (pi.status !== "succeeded") {
    throw Object.assign(new Error("payment_capture_failed"), { status: 402 });
  }

  await mutateDb(db => {
    const o = db.orders.find(x => x.id === latest.id);
    if (o && (o.paymentStatus === "authorized" || o.paymentStatus === "none")) {
      o.paymentStatus = "captured";
      o.updatedAt = new Date().toISOString();
    }
  });

  const { transferCents } = sellerTransferCents(latest.priceCents);
  if (transferCents <= 0) {
    return { paymentStatus: "captured", stripeTransferId: null };
  }

  const source = chargeIdFromPi(pi);
  if (!source) {
    throw Object.assign(new Error("payment_capture_failed"), { status: 402 });
  }

  const stripeAccountId = await sellerPayoutDestination(sellerId);
  if (!stripeAccountId) {
    return { paymentStatus: "credited", stripeTransferId: null };
  }

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: transferCents,
        currency: "usd",
        destination: stripeAccountId,
        transfer_group: pi.transfer_group ?? undefined,
        source_transaction: source,
        metadata: {
          order_id: latest.id,
          seller_user_id: sellerId,
        },
      },
      { idempotencyKey: `transfer_${latest.id}_${piId}` },
    );

    await mutateDb(db => {
      const o = db.orders.find(x => x.id === latest.id);
      if (o) {
        o.transferLastError = null;
        o.updatedAt = new Date().toISOString();
      }
    });

    return { paymentStatus: "transferred", stripeTransferId: transfer.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "transfer_failed";
    await mutateDb(db => {
      const o = db.orders.find(x => x.id === latest.id);
      if (o) {
        o.paymentStatus = "captured";
        o.transferLastError = message.slice(0, 500);
        o.updatedAt = new Date().toISOString();
      }
    });
    throw Object.assign(new Error("transfer_failed"), {
      status: 502,
      cause: err,
    });
  }
}

/** Stripe snapshot for admin inspection (no secrets). */
export async function inspectOrderStripe(order: Order): Promise<{
  paymentIntent: {
    id: string;
    status: string;
    amount: number;
    captureMethod: string | null;
  } | null;
  transfer: {
    id: string;
    amount: number;
    destination: string | null;
    reversed: boolean;
  } | null;
  refund: { id: string; status: string | null; amount: number } | null;
  dispute: {
    id: string;
    status: string;
    reason: string | null;
    amount: number;
  } | null;
}> {
  if (!paymentsEnabled() || !order.stripePaymentIntentId) {
    return {
      paymentIntent: null,
      transfer: null,
      refund: null,
      dispute: null,
    };
  }

  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);

  let transfer: {
    id: string;
    amount: number;
    destination: string | null;
    reversed: boolean;
  } | null = null;
  if (order.stripeTransferId) {
    const t = await stripe.transfers.retrieve(order.stripeTransferId);
    transfer = {
      id: t.id,
      amount: t.amount,
      destination: typeof t.destination === "string" ? t.destination : null,
      reversed: Boolean(t.reversed),
    };
  }

  let refund: { id: string; status: string | null; amount: number } | null =
    null;
  if (order.stripeRefundId) {
    const r = await stripe.refunds.retrieve(order.stripeRefundId);
    refund = { id: r.id, status: r.status, amount: r.amount };
  }

  let dispute: {
    id: string;
    status: string;
    reason: string | null;
    amount: number;
  } | null = null;
  if (order.stripeDisputeId) {
    const d = await stripe.disputes.retrieve(order.stripeDisputeId);
    dispute = {
      id: d.id,
      status: d.status,
      reason: d.reason ?? null,
      amount: d.amount,
    };
  }

  return {
    paymentIntent: {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      captureMethod: pi.capture_method ?? null,
    },
    transfer,
    refund,
    dispute,
  };
}

/**
 * Void auth or refund captured funds (and reverse a transfer if one exists).
 * Used for pre-drop-off cancel and post-drop-off refund.
 */
export async function refundEscrowPayment(order: Order): Promise<{
  paymentStatus: PaymentStatus;
  stripeRefundId: string | null;
  stripeTransferId: string | null;
}> {
  if (!paymentsEnabled() || !order.stripePaymentIntentId) {
    return {
      paymentStatus: "none",
      stripeRefundId: null,
      stripeTransferId: order.stripeTransferId,
    };
  }

  const latest = getDb().orders.find(o => o.id === order.id) ?? order;
  if (latest.paymentStatus === "refunded") {
    return {
      paymentStatus: "refunded",
      stripeRefundId: latest.stripeRefundId,
      stripeTransferId: latest.stripeTransferId,
    };
  }
  if (latest.paymentStatus === "cancelled" && !latest.stripePaymentIntentId) {
    return {
      paymentStatus: "cancelled",
      stripeRefundId: null,
      stripeTransferId: null,
    };
  }

  const stripe = getStripe();
  const piId = latest.stripePaymentIntentId!;

  if (latest.stripeTransferId) {
    await stripe.transfers.createReversal(
      latest.stripeTransferId,
      { metadata: { order_id: latest.id, reason: "escrow_refund" } },
      { idempotencyKey: `transfer_reversal_${latest.id}_${latest.stripeTransferId}` },
    );
  }

  const pi = await stripe.paymentIntents.retrieve(piId);
  let stripeRefundId: string | null = latest.stripeRefundId;

  if (pi.status === "requires_capture" || pi.status === "requires_confirmation") {
    await stripe.paymentIntents.cancel(piId, undefined, {
      idempotencyKey: `pi_cancel_${latest.id}_${piId}`,
    });
    return {
      paymentStatus: "cancelled",
      stripeRefundId: null,
      stripeTransferId: latest.stripeTransferId,
    };
  }

  if (pi.status === "succeeded") {
    const refund = await stripe.refunds.create(
      {
        payment_intent: piId,
        metadata: { order_id: latest.id },
      },
      { idempotencyKey: `pi_refund_${latest.id}_${piId}` },
    );
    stripeRefundId = refund.id;
    return {
      paymentStatus: "refunded",
      stripeRefundId,
      stripeTransferId: latest.stripeTransferId,
    };
  }

  if (pi.status === "canceled") {
    return {
      paymentStatus: "cancelled",
      stripeRefundId: null,
      stripeTransferId: latest.stripeTransferId,
    };
  }

  throw Object.assign(new Error("payment_refund_failed"), { status: 502 });
}

export function findOrderByPaymentIntentId(
  paymentIntentId: string,
): Order | undefined {
  return getDb().orders.find(o => o.stripePaymentIntentId === paymentIntentId);
}
