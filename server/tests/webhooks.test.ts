import { describe, expect, it, vi } from "vitest";

import type { Order } from "../src/types.js";

const orders = new Map<string, Order>();

vi.mock("../src/db.js", () => ({
  getDb: () => ({
    orders: [...orders.values()],
    listings: [],
    profiles: [],
    favorites: [],
    processedStripeEvents: [] as string[],
    processedRelaiEvents: [] as string[],
  }),
  mutateDb: async (mutator: (db: {
    orders: Order[];
    processedStripeEvents: string[];
  }) => void) => {
    const db = {
      orders: [...orders.values()],
      processedStripeEvents: [] as string[],
    };
    mutator(db);
    for (const o of db.orders) orders.set(o.id, o);
  },
}));

vi.mock("../src/payments.js", () => ({
  findOrderByPaymentIntentId: (pi: string) =>
    [...orders.values()].find(o => o.stripePaymentIntentId === pi) ?? null,
  refreshPayoutReadinessByAccountId: vi.fn(async () => undefined),
}));

vi.mock("../src/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/stripe.js", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        throw new Error("not used in unit test");
      },
    },
  }),
  paymentsEnabled: () => true,
}));

describe("stripe dispute webhook helpers", () => {
  it("applyDisputeOpened freezes escrow", async () => {
    const ts = new Date().toISOString();
    orders.set("ord_1", {
      id: "ord_1",
      listingId: "lst_1",
      buyerUserId: "b",
      sellerUserId: "s",
      priceCents: 1000,
      status: "ready_for_pickup",
      exchangeZoneId: "ez",
      exchangeZoneName: "EZ",
      exchangeZoneAddress: null,
      dropOffPhotoUrl: null,
      relaiOrderId: null,
      pickupLinkCode: null,
      pickupLinkExpiresAt: null,
      sellerAcceptDeadlineAt: null,
      sellerDropOffDeadlineAt: null,
      relaiPickupVerifiedAt: null,
      relaiWebhookEventId: null,
      pickupVerifiedVia: null,
      stripePaymentIntentId: "pi_1",
      stripeTransferId: null,
      stripeRefundId: null,
      transferLastError: null,
      paymentStatus: "authorized",
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
    });

    const { applyDisputeOpened, mapStripeDisputeStatus } = await import(
      "../src/escrow.js"
    );
    expect(mapStripeDisputeStatus("needs_response")).toBe("needs_response");
    await applyDisputeOpened("ord_1", "dp_123", "needs_response");
    const order = orders.get("ord_1")!;
    expect(order.paymentStatus).toBe("disputed");
    expect(order.stripeDisputeId).toBe("dp_123");
    expect(order.adminHold).toBe(true);
    expect(order.paymentStatusBeforeDispute).toBe("authorized");
  });
});
