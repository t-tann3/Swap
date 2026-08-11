import { describe, expect, it } from "vitest";

import {
  applyStockAdjustment,
  defaultPantrySettings,
  fulfillmentBucket,
  fulfillmentSortKey,
  syncListingStockStatus,
} from "../src/pantry.js";
import type { Listing, Order } from "../src/types.js";

function listing(partial: Partial<Listing> = {}): Listing {
  const ts = new Date().toISOString();
  return {
    id: "lst_1",
    sellerUserId: "seller",
    sellerEmail: null,
    sellerName: null,
    title: "Beans",
    description: "Canned",
    priceCents: 0,
    category: "Food",
    condition: "good",
    locationLabel: "EZ",
    status: "available",
    imageColor: "#000",
    imageUrl: null,
    stockQty: 10,
    maxPerOrder: 2,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

function order(partial: Partial<Order> = {}): Order {
  const ts = new Date().toISOString();
  return {
    id: "ord_1",
    listingId: "lst_1",
    items: [{ listingId: "lst_1", quantity: 1, title: "Beans" }],
    buyerUserId: "buyer",
    sellerUserId: "seller",
    priceCents: 0,
    status: "accepted",
    exchangeZoneId: "ez",
    exchangeZoneName: "Zone",
    exchangeZoneAddress: null,
    dropOffPhotoUrl: null,
    relaiOrderId: null,
    pickupLinkCode: null,
    pickupLinkExpiresAt: null,
    stripePaymentIntentId: null,
    stripeTransferId: null,
    stripeRefundId: null,
    paymentStatus: "none",
    sellerAcceptDeadlineAt: null,
    sellerDropOffDeadlineAt: null,
    transferLastError: null,
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
    relaiPickupVerifiedAt: null,
    relaiWebhookEventId: null,
    pickupVerifiedVia: null,
    ...partial,
  };
}

describe("stock adjustments", () => {
  it("increments and decrements with reason", () => {
    const item = listing({ stockQty: 5 });
    const up = applyStockAdjustment(item, "seller", 3, "donation intake");
    expect(up.previousQty).toBe(5);
    expect(up.nextQty).toBe(8);
    expect(item.stockQty).toBe(8);
    expect(item.status).toBe("available");

    const down = applyStockAdjustment(item, "seller", -8, "spoiled");
    expect(down.nextQty).toBe(0);
    expect(item.status).toBe("out_of_stock");
  });

  it("rejects empty reason", () => {
    expect(() => applyStockAdjustment(listing(), "seller", 1, " ")).toThrow(
      "invalid_reason",
    );
  });
});

describe("fulfillment queue buckets", () => {
  it("marks overdue drop-offs", () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(
      fulfillmentBucket(
        order({
          status: "accepted",
          sellerDropOffDeadlineAt: "2026-08-11T11:00:00.000Z",
        }),
        now,
      ),
    ).toBe("overdue");
    expect(
      fulfillmentBucket(
        order({
          status: "accepted",
          sellerDropOffDeadlineAt: "2026-08-11T13:00:00.000Z",
        }),
        now,
      ),
    ).toBe("needs_drop_off");
    expect(fulfillmentBucket(order({ status: "pending_accept" }), now)).toBe(
      "needs_accept",
    );
    expect(fulfillmentSortKey(order({ status: "ready_for_pickup" }), now)).toBeGreaterThan(
      fulfillmentSortKey(
        order({
          status: "accepted",
          sellerDropOffDeadlineAt: "2026-08-11T11:00:00.000Z",
        }),
        now,
      ),
    );
  });
});

describe("pantry settings defaults", () => {
  it("includes basket TTL and low-stock threshold", () => {
    const s = defaultPantrySettings();
    expect(s.basketHoldTtlMinutes).toBe(120);
    expect(s.lowStockThreshold).toBe(3);
    const item = listing({ stockQty: 0, status: "out_of_stock" });
    syncListingStockStatus(item);
    expect(item.status).toBe("out_of_stock");
  });
});
