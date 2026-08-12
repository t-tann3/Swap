import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/types.js";

const dbHolder: { db: Database } = {
  db: {
    profiles: [],
    listings: [],
    orders: [],
    favorites: [],
    baskets: [],
    pantrySettings: {
      id: "default",
      enabled: true,
      defaultPatronCap: 5,
      hardReserveEnabled: true,
      basketHoldTtlMinutes: 120,
      lowStockThreshold: 3,
      updatedAt: "t0",
    },
    stockAdjustments: [],
    pantries: [],
    pantryMemberships: [],
    pantryInvites: [],
    pantryPatrons: [],
    processedStripeEvents: [],
    processedRelaiEvents: [],
  },
};

vi.mock("../src/db.js", () => ({
  getDb: () => dbHolder.db,
  mutateDb: async (mutator: (db: Database) => void) => {
    mutator(dbHolder.db);
    return dbHolder.db;
  },
  newId: (prefix: string) => `${prefix}_test`,
}));

describe("pantryPatrons", () => {
  beforeEach(() => {
    dbHolder.db = {
      profiles: [
        {
          userId: "owner_1",
          email: "owner@example.com",
          name: "Owner",
          roles: ["seller"],
          bio: "",
          stripeAccountId: null,
          stripePayoutsReady: false,
          patronCap: null,
          isPantrySeller: true,
          pantryBlocked: false,
          adminOptOut: false,
          pushDevices: [],
          createdAt: "t0",
          updatedAt: "t0",
        },
      ],
      listings: [],
      orders: [],
      favorites: [],
      baskets: [],
      pantrySettings: {
        id: "default",
        enabled: true,
        defaultPatronCap: 5,
        hardReserveEnabled: true,
        basketHoldTtlMinutes: 120,
        lowStockThreshold: 3,
        updatedAt: "t0",
      },
      stockAdjustments: [],
      pantries: [],
      pantryMemberships: [],
      pantryInvites: [],
      pantryPatrons: [],
      processedStripeEvents: [],
      processedRelaiEvents: [],
    };
  });

  it("parses CSV and enforces allowlist when enabled", async () => {
    const org = await import("../src/pantryOrg.js");
    const patrons = await import("../src/pantryPatrons.js");

    await org.ensureOwnerPantry({
      userId: "owner_1",
      email: "owner@example.com",
      name: "Owner",
    });

    const csv = `email,first_name,last_name,phone
neighbor@example.com,Ada,Neighbor,555-0100
bad-row
`;
    const rows = patrons.parsePatronCsv(csv);
    expect(rows).toHaveLength(2);

    const result = await patrons.upsertPatronsFromRows("owner_1", rows);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);

    const pantry = org.getPantryByOwner("owner_1")!;
    expect(patrons.canShopPantry(pantry, {
      userId: "n1",
      email: "neighbor@example.com",
    })).toBe(true);

    await patrons.setPatronAllowlistEnabled("owner_1", true);
    const locked = org.getPantryByOwner("owner_1")!;
    expect(
      patrons.canShopPantry(locked, {
        userId: "stranger",
        email: "stranger@example.com",
      }),
    ).toBe(false);
    expect(
      patrons.canShopPantry(locked, {
        userId: "n1",
        email: "neighbor@example.com",
      }),
    ).toBe(true);
    // Owner/staff always allowed.
    expect(
      patrons.canShopPantry(locked, {
        userId: "owner_1",
        email: "owner@example.com",
      }),
    ).toBe(true);

    await patrons.matchPatronsForUser({
      userId: "n1",
      email: "neighbor@example.com",
      name: "Ada",
    });
    expect(dbHolder.db.pantryPatrons[0]?.status).toBe("matched");
    expect(dbHolder.db.pantryPatrons[0]?.userId).toBe("n1");
  });

  it("allows shopping when enforcement is off", async () => {
    const org = await import("../src/pantryOrg.js");
    const patrons = await import("../src/pantryPatrons.js");
    await org.ensureOwnerPantry({
      userId: "owner_1",
      email: "owner@example.com",
      name: "Owner",
    });
    const pantry = org.getPantryByOwner("owner_1")!;
    expect(
      patrons.canShopPantry(pantry, {
        userId: "anyone",
        email: "anyone@example.com",
      }),
    ).toBe(true);
  });
});
