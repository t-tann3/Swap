import { readFileSync } from "node:fs";

import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import { getDb, mutateDb } from "./db.js";
import { log } from "./logger.js";
import type { Order, PushDevice } from "./types.js";

let initAttempted = false;
let ready = false;

function loadServiceAccount(): ServiceAccount | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    return JSON.parse(inline) as ServiceAccount;
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    return JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
  }
  return null;
}

/** Initialize Firebase Admin once. Safe to call repeatedly. */
export function initFirebaseAdmin(): boolean {
  if (initAttempted) return ready;
  initAttempted = true;

  try {
    const account = loadServiceAccount();
    if (!account) {
      log.warn("firebase_admin_skip", {
        detail:
          "FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS unset",
      });
      return false;
    }
    if (!getApps().length) {
      initializeApp({
        credential: cert(account),
      });
    }
    ready = true;
    log.info("firebase_admin_ready", {});
    return true;
  } catch (err) {
    log.warn("firebase_admin_init_fail", {
      errMessage: err instanceof Error ? err.message : String(err),
    });
    ready = false;
    return false;
  }
}

export function pushConfigured(): boolean {
  if (!initAttempted) initFirebaseAdmin();
  return ready;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Optional deep-link style data (string values only for FCM). */
  data?: Record<string, string>;
};

/**
 * Send a push to every registered device for a user.
 * Ready for order-event wiring — not called from routes yet.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!pushConfigured()) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const profile = getDb().profiles.find(p => p.userId === userId);
  const devices = profile?.pushDevices ?? [];
  if (!devices.length) {
    return { sent: 0, failed: 0, skipped: true };
  }

  let sent = 0;
  let failed = 0;
  const staleTokens: string[] = [];
  const messaging = getMessaging();

  for (const device of devices) {
    try {
      await messaging.send({
        token: device.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        staleTokens.push(device.token);
      }
      log.warn("push_send_fail", {
        userId,
        errMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (staleTokens.length) {
    await mutateDb(db => {
      const p = db.profiles.find(x => x.userId === userId);
      if (!p) return;
      p.pushDevices = (p.pushDevices ?? []).filter(
        d => !staleTokens.includes(d.token),
      );
      p.updatedAt = new Date().toISOString();
    });
  }

  return { sent, failed, skipped: false };
}

/** Fire-and-forget wrapper — a push failure must never break an order flow. */
function notify(userId: string, payload: PushPayload, event: string): void {
  void sendPushToUser(userId, payload).catch(err => {
    log.warn("push_notify_fail", {
      event,
      userId,
      errMessage: err instanceof Error ? err.message : String(err),
    });
  });
}

function neighborLabel(order: Order): string {
  const buyer = getDb().profiles.find(p => p.userId === order.buyerUserId);
  return buyer?.name || buyer?.email || "Your neighbor";
}

/** Pantry accepted the order → tell the neighbor. */
export function notifyOrderAccepted(order: Order): void {
  notify(
    order.buyerUserId,
    {
      title: "Order accepted",
      body: "The pantry accepted your basket. We'll let you know when it's ready for pickup.",
      data: { type: "order_accepted", orderId: order.id },
    },
    "order_accepted",
  );
}

/** Pantry dropped the basket in the Exchange Zone → tell the neighbor. */
export function notifyOrderReadyForPickup(order: Order): void {
  const zone = order.exchangeZoneName?.trim();
  notify(
    order.buyerUserId,
    {
      title: "Basket ready for pickup",
      body: zone
        ? `Your basket is waiting at ${zone}. Open Swap to pick it up.`
        : "Your basket is in the Exchange Zone. Open Swap to pick it up.",
      data: { type: "order_ready_for_pickup", orderId: order.id },
    },
    "order_ready_for_pickup",
  );
}

/** Neighbor picked the basket up → tell the pantry. */
export function notifyOrderPickedUp(order: Order): void {
  notify(
    order.sellerUserId,
    {
      title: "Basket picked up",
      body: `${neighborLabel(order)} picked up their basket.`,
      data: { type: "order_picked_up", orderId: order.id },
    },
    "order_picked_up",
  );
}

export function upsertPushDevice(
  devices: PushDevice[] | undefined,
  next: PushDevice,
): PushDevice[] {
  const list = [...(devices ?? [])].filter(d => d.token !== next.token);
  list.push(next);
  // Cap per user so a reinstall loop cannot grow forever.
  return list.slice(-10);
}
