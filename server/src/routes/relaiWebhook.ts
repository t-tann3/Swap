import {
  verifyWebhook,
  type AnyWebhookEvent,
} from "@relai-team/access-sdk";
import { Router, type Request, type Response } from "express";

import { mutateDb } from "../db.js";
import {
  finalizeOrderEscrow,
  findOrderByRelaiOrderId,
  markRelaiPickupVerified,
} from "../escrow.js";
import { relaiWebhookSecret, relaiWebhooksConfigured } from "../relai.js";

export const relaiWebhookRouter = Router();

const MAX_PROCESSED_EVENTS = 500;

async function markEventProcessed(eventId: string): Promise<boolean> {
  let isNew = false;
  await mutateDb(db => {
    if (!db.processedRelaiEvents) db.processedRelaiEvents = [];
    if (db.processedRelaiEvents.includes(eventId)) return;
    isNew = true;
    db.processedRelaiEvents.push(eventId);
    if (db.processedRelaiEvents.length > MAX_PROCESSED_EVENTS) {
      db.processedRelaiEvents = db.processedRelaiEvents.slice(
        -MAX_PROCESSED_EVENTS,
      );
    }
  });
  return isNew;
}

async function handleRelaiEvent(event: AnyWebhookEvent): Promise<void> {
  switch (event.type) {
    case "order.completed": {
      // Platform-forced completion (e.g. node out of service) is not buyer pickup.
      if (event.data.reason === "node_out_of_service") {
        console.warn(
          `[relai] order.completed node_out_of_service relaiOrder=${event.data.order.id}`,
        );
        break;
      }

      const relaiOrderId = event.data.order.id;
      const order = findOrderByRelaiOrderId(relaiOrderId);
      if (!order) {
        console.warn(
          `[relai] order.completed for unknown relaiOrder=${relaiOrderId}`,
        );
        break;
      }
      if (order.status === "completed") break;
      if (order.status !== "ready_for_pickup") {
        console.warn(
          `[relai] order.completed ignored order=${order.id} status=${order.status}`,
        );
        break;
      }

      await markRelaiPickupVerified(order.id, "webhook", event.id);
      await finalizeOrderEscrow(order.id, "pickup");
      console.log(
        `[relai] trusted pickup release order=${order.id} relaiOrder=${relaiOrderId}`,
      );
      break;
    }
    case "order.abandoned": {
      console.warn(
        `[relai] order.abandoned relaiOrder=${event.data.order_id} (no-show sweep handles escrow)`,
      );
      break;
    }
    default:
      break;
  }
}

/**
 * Relai webhook endpoint. Must be mounted with express.raw so the signature
 * is verified against the exact request body.
 */
relaiWebhookRouter.post("/", async (req: Request, res: Response) => {
  const secret = relaiWebhookSecret();
  if (!secret) {
    console.warn("[relai] RELAI_WEBHOOK_SECRET not set; rejecting webhooks");
    res.status(503).json({
      code: "webhook_unconfigured",
      message: "RELAI_WEBHOOK_SECRET is not configured.",
    });
    return;
  }

  const signature = req.headers["x-relai-signature"];
  if (typeof signature !== "string") {
    res.status(400).json({
      code: "missing_signature",
      message: "Missing X-Relai-Signature.",
    });
    return;
  }

  const payload = req.body as Buffer;
  const rawBody =
    Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload ?? "");

  const ok = await verifyWebhook({
    payload: rawBody,
    signature,
    secret,
  });
  if (!ok) {
    console.warn("[relai] webhook signature verification failed");
    res.status(400).json({
      code: "invalid_signature",
      message: "Invalid signature.",
    });
    return;
  }

  let event: AnyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as AnyWebhookEvent;
  } catch {
    res.status(400).json({ code: "invalid_json", message: "Invalid JSON body." });
    return;
  }

  if (!event?.id || !event?.type) {
    res.status(400).json({ code: "invalid_event", message: "Missing event id/type." });
    return;
  }

  const isNew = await markEventProcessed(event.id);
  if (!isNew) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    await handleRelaiEvent(event);
    res.json({ received: true });
  } catch (err) {
    await mutateDb(db => {
      db.processedRelaiEvents = (db.processedRelaiEvents ?? []).filter(
        id => id !== event.id,
      );
    });
    console.warn(
      "[relai] webhook handler error",
      event.type,
      err instanceof Error ? err.message : err,
    );
    res.status(500).json({
      code: "handler_failed",
      message: "Webhook handler failed.",
    });
  }
});

export { relaiWebhooksConfigured };
