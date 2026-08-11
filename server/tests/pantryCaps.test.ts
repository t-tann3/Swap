import { describe, expect, it } from "vitest";

import {
  consumeListingUnits,
  listingBasketLimit,
  listingMaxPerOrder,
  markListingUnitCompleted,
  releaseListingUnits,
  syncListingStockStatus,
} from "../src/pantry.js";
import type { Listing } from "../src/types.js";

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

describe("per-item pantry caps", () => {
  it("defaults maxPerOrder to 1 when missing", () => {
    expect(listingMaxPerOrder(listing({ maxPerOrder: undefined as never }))).toBe(
      1,
    );
    expect(listingMaxPerOrder(listing({ maxPerOrder: 0 }))).toBe(1);
  });

  it("returns configured maxPerOrder", () => {
    expect(listingMaxPerOrder(listing({ maxPerOrder: 3 }))).toBe(3);
  });

  it("basket limit is min(maxPerOrder, free + held)", () => {
    expect(listingBasketLimit(listing({ maxPerOrder: 5, stockQty: 2 }))).toBe(2);
    expect(listingBasketLimit(listing({ maxPerOrder: 1, stockQty: 20 }))).toBe(1);
    expect(
      listingBasketLimit(
        listing({ status: "out_of_stock", maxPerOrder: 5, stockQty: 0 }),
        2,
      ),
    ).toBe(2);
    expect(
      listingBasketLimit(listing({ maxPerOrder: 5, stockQty: 1 }), 2),
    ).toBe(3);
  });
});

describe("multi-unit stock lifecycle", () => {
  it("consume reduces stock and marks out_of_stock when depleted", () => {
    const item = listing({ stockQty: 2 });
    consumeListingUnits(item, 1);
    expect(item.stockQty).toBe(1);
    expect(item.status).toBe("available");
    consumeListingUnits(item, 1);
    expect(item.stockQty).toBe(0);
    expect(item.status).toBe("out_of_stock");
  });

  it("consume rejects oversell", () => {
    const item = listing({ stockQty: 1 });
    expect(() => consumeListingUnits(item, 2)).toThrow("insufficient_stock");
    expect(item.stockQty).toBe(1);
  });

  it("release restores stock even when listing stayed available", () => {
    const item = listing({ stockQty: 5, status: "available" });
    releaseListingUnits(item, 1);
    expect(item.stockQty).toBe(6);
    expect(item.status).toBe("available");
  });

  it("release from out_of_stock makes listing available again", () => {
    const item = listing({ stockQty: 0, status: "out_of_stock" });
    releaseListingUnits(item, 1);
    expect(item.stockQty).toBe(1);
    expect(item.status).toBe("available");
  });

  it("complete keeps available when stock remains", () => {
    const item = listing({ stockQty: 4, status: "available" });
    markListingUnitCompleted(item);
    expect(item.status).toBe("available");
    expect(item.stockQty).toBe(4);
  });

  it("complete marks sold when depleted outside pantry mode", () => {
    const item = listing({ stockQty: 0, status: "reserved" });
    markListingUnitCompleted(item);
    expect(item.status).toBe("sold");
  });

  it("syncListingStockStatus restocks out_of_stock listings", () => {
    const item = listing({ stockQty: 3, status: "out_of_stock" });
    syncListingStockStatus(item);
    expect(item.status).toBe("available");
  });

  it("syncListingStockStatus marks out_of_stock at zero", () => {
    const item = listing({ stockQty: 0, status: "available" });
    syncListingStockStatus(item);
    expect(item.status).toBe("out_of_stock");
  });
});
