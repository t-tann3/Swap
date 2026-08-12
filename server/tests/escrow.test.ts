import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "../src/types.js";

const orders = new Map<string, Order>();

function baseOrder(overrides: Partial<Order> = {}): Order {
  const ts = new Date().toISOString();
  return {
    id: "ord_test",
    listingId: "lst_1",
    items: [
      {
        listingId: "lst_1",
        quantity: 1,
        title: "Test",
      },
    ],
    buyerUserId: "buyer_1",
    sellerUserId: "seller_1",
    priceCents: 2500,
    status: "ready_for_pickup",
    exchangeZoneId: "ez_1",
    exchangeZoneName: "Main EZ",
    exchangeZoneAddress: null,
    dropOffPhotoUrl: null,
    relaiOrderId: "relai_1",
    pickupLinkCode: "pickup_1",
    pickupLinkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sellerAcceptDeadlineAt: null,
    sellerDropOffDeadlineAt: null,
    relaiPickupVerifiedAt: ts,
    relaiWebhookEventId: "evt_1",
    pickupVerifiedVia: "webhook",
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
    ...overrides,
  };
}

vi.mock("../src/db.js", () => ({
  getDb: () => ({
    orders: [...orders.values()],
    listings: [
      {
        id: "lst_1",
        status: "reserved",
        updatedAt: new Date().toISOString(),
      },
    ],
    profiles: [],
    favorites: [],
    processedStripeEvents: [],
    processedRelaiEvents: [],
  }),
  mutateDb: async (mutator: (db: { orders: Order[]; listings: { id: string; status: string; updatedAt: string }[] }) => void) => {
    const db = {
      orders: [...orders.values()],
      listings: [
        {
          id: "lst_1",
          status: "reserved" as string,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    mutator(db);
    for (const o of db.orders) orders.set(o.id, o);
  },
  newId: (prefix: string) => `${prefix}_test`,
}));

vi.mock("../src/payments.js", () => ({
  releasePaymentOnPickup: vi.fn(async () => ({
    paymentStatus: "transferred",
    stripeTransferId: "tr_1",
  })),
  refundEscrowPayment: vi.fn(async () => ({
    paymentStatus: "refunded",
    stripeRefundId: "re_1",
  })),
  cancelAuthorizedPayment: vi.fn(async () => undefined),
  refreshSellerPayoutReadiness: vi.fn(async () => false),
}));

vi.mock("../src/relai.js", () => ({
  fetchRelaiOrderStatus: vi.fn(async () => "completed"),
}));

vi.mock("../src/logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("escrow finalize / refund", () => {
  beforeEach(() => {
    orders.clear();
    orders.set("ord_test", baseOrder());
  });

  it("finalizes escrow on pickup", async () => {
    const { finalizeOrderEscrow } = await import("../src/escrow.js");
    const order = await finalizeOrderEscrow("ord_test", "pickup");
    expect(order.status).toBe("completed");
    expect(order.completedReason).toBe("pickup");
    expect(order.paymentStatus).toBe("transferred");
    expect(order.stripeTransferId).toBe("tr_1");
  });

  it("refunds ready_for_pickup orders", async () => {
    const { refundOrderEscrow } = await import("../src/escrow.js");
    const order = await refundOrderEscrow("ord_test", "post_dropoff_refund");
    expect(order.status).toBe("cancelled");
    expect(order.cancelledReason).toBe("post_dropoff_refund");
    expect(order.paymentStatus).toBe("refunded");
  });

  it("voids pre-drop-off authorization", async () => {
    orders.set(
      "ord_test",
      baseOrder({
        status: "accepted",
        relaiPickupVerifiedAt: null,
        pickupVerifiedVia: null,
      }),
    );
    const { voidPreDropoffEscrow } = await import("../src/escrow.js");
    const order = await voidPreDropoffEscrow(
      "ord_test",
      "buyer_or_seller_cancel",
    );
    expect(order.status).toBe("cancelled");
    expect(order.cancelledReason).toBe("buyer_or_seller_cancel");
  });

  it("blocks finalize while disputed", async () => {
    orders.set(
      "ord_test",
      baseOrder({
        paymentStatus: "disputed",
        stripeDisputeId: "dp_1",
        adminHold: true,
      }),
    );
    const { finalizeOrderEscrow } = await import("../src/escrow.js");
    await expect(finalizeOrderEscrow("ord_test", "pickup")).rejects.toMatchObject(
      { message: "payment_disputed" },
    );
  });

  it("completes the sale and credits a seller without payout setup", async () => {
    const payments = await import("../src/payments.js");
    vi.mocked(payments.releasePaymentOnPickup).mockResolvedValueOnce({
      paymentStatus: "credited",
      stripeTransferId: null,
    });

    const { finalizeOrderEscrow } = await import("../src/escrow.js");
    const order = await finalizeOrderEscrow("ord_test", "pickup");

    expect(order.status).toBe("completed");
    expect(order.paymentStatus).toBe("credited");
    expect(order.stripeTransferId).toBeNull();
  });

  it("settles held credits once the seller can be paid", async () => {
    orders.set(
      "ord_test",
      baseOrder({
        status: "completed",
        paymentStatus: "credited",
        completedReason: "pickup",
      }),
    );

    const { settleSellerCredits } = await import("../src/escrow.js");
    const result = await settleSellerCredits("seller_1");

    expect(result).toEqual({ settled: 1, pending: 0 });
    expect(orders.get("ord_test")?.paymentStatus).toBe("transferred");
    expect(orders.get("ord_test")?.stripeTransferId).toBe("tr_1");
  });

  it("leaves credits held while the seller still cannot be paid", async () => {
    orders.set(
      "ord_test",
      baseOrder({
        status: "completed",
        paymentStatus: "credited",
        completedReason: "pickup",
      }),
    );

    const { sweepSellerCredits } = await import("../src/escrow.js");
    const result = await sweepSellerCredits();

    expect(result).toEqual({ checked: 1, settled: 0, sellersPending: 1 });
    expect(orders.get("ord_test")?.paymentStatus).toBe("credited");
  });

  it("opens a platform dispute and freezes the order", async () => {
    const { openPlatformDispute } = await import("../src/escrow.js");
    const order = await openPlatformDispute(
      "ord_test",
      "buyer_1",
      "Item missing from compartment after unlock",
    );
    expect(order.adminHold).toBe(true);
    expect(order.platformDisputeOpenedBy).toBe("buyer_1");
    expect(order.platformDisputeReason).toContain("missing");
  });
});
