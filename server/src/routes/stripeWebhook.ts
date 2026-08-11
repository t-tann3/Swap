import { Router, type Request, type Response } from "express";
import type Stripe from "stripe";

import { mutateDb } from "../db.js";
import {
  findOrderByPaymentIntentId,
  refreshPayoutReadinessByAccountId,
} from "../payments.js";
import { getStripe, paymentsEnabled } from "../stripe.js";

export const stripeWebhookRouter = Router();

const MAX_PROCESSED_EVENTS = 500;

async function markEventProcessed(eventId: string): Promise<boolean> {
  let isNew = false;
  await mutateDb(db => {
    if (!db.processedStripeEvents) db.processedStripeEvents = [];
    if (db.processedStripeEvents.includes(eventId)) return;
    isNew = true;
    db.processedStripeEvents.push(eventId);
    if (db.processedStripeEvents.length > MAX_PROCESSED_EVENTS) {
      db.processedStripeEvents = db.processedStripeEvents.slice(
        -MAX_PROCESSED_EVENTS,
      );
    }
  });
  return isNew;
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await refreshPayoutReadinessByAccountId(account.id);
      break;
    }
    case "capability.updated": {
      const capability = event.data.object as Stripe.Capability;
      const accountId =
        typeof capability.account === "string"
          ? capability.account
          : capability.account?.id;
      if (accountId) {
        await refreshPayoutReadinessByAccountId(accountId);
      }
      break;
    }
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const order = findOrderByPaymentIntentId(pi.id);
      if (!order) break;
      if (
        order.status === "completed" ||
        order.paymentStatus === "transferred" ||
        order.paymentStatus === "refunded"
      ) {
        break;
      }
      await mutateDb(db => {
        const o = db.orders.find(x => x.id === order.id);
        if (!o) return;
        if (o.paymentStatus === "authorized" || o.paymentStatus === "captured") {
          o.paymentStatus = "cancelled";
          o.updatedAt = new Date().toISOString();
        }
      });
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const piId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      if (!piId) break;
      const order = findOrderByPaymentIntentId(piId);
      if (!order) break;
      await mutateDb(db => {
        const o = db.orders.find(x => x.id === order.id);
        if (!o) return;
        o.paymentStatus = "disputed";
        o.updatedAt = new Date().toISOString();
      });
      console.warn(
        `[stripe] dispute created order=${order.id} dispute=${dispute.id}`,
      );
      break;
    }
    default: {
      // Some Connect payout failures surface as transfer.* variants depending on API version.
      if (String(event.type).startsWith("transfer.")) {
        const transfer = event.data.object as Stripe.Transfer;
        console.warn(
          `[stripe] ${event.type} id=${transfer.id} order=${transfer.metadata?.order_id ?? "?"}`,
        );
      }
      break;
    }
  }
}

/**
 * Stripe webhook endpoint. Must be mounted with express.raw so the signature
 * is verified against the exact request body.
 */
stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!paymentsEnabled()) {
    res.status(503).json({ code: "payments_disabled", message: "Payments off." });
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set; rejecting webhooks");
    res.status(503).json({
      code: "webhook_unconfigured",
      message: "STRIPE_WEBHOOK_SECRET is not configured.",
    });
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    res.status(400).json({ code: "missing_signature", message: "Missing Stripe-Signature." });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    const payload = req.body as Buffer;
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.warn(
      "[stripe] webhook signature verification failed",
      err instanceof Error ? err.message : err,
    );
    res.status(400).json({ code: "invalid_signature", message: "Invalid signature." });
    return;
  }

  const isNew = await markEventProcessed(event.id);
  if (!isNew) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    // Allow Stripe to retry — drop the event id so the next delivery re-runs.
    await mutateDb(db => {
      db.processedStripeEvents = (db.processedStripeEvents ?? []).filter(
        id => id !== event.id,
      );
    });
    console.warn(
      "[stripe] webhook handler error",
      event.type,
      err instanceof Error ? err.message : err,
    );
    res.status(500).json({ code: "handler_failed", message: "Webhook handler failed." });
  }
});

/** Dev helper: whether the webhook secret is configured (no secret leaked). */
export function stripeWebhooksConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
}
