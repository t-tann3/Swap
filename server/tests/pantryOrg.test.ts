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
      updatedAt: new Date().toISOString(),
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

describe("pantryOrg", () => {
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

  it("creates an owner pantry and lets members act for the owner seller id", async () => {
    const org = await import("../src/pantryOrg.js");
    const pantry = await org.ensureOwnerPantry({
      userId: "owner_1",
      email: "owner@example.com",
      name: "Owner",
    });
    expect(pantry.ownerUserId).toBe("owner_1");

    await org.inviteByEmail("owner_1", "member@example.com");
    expect(dbHolder.db.pantryInvites).toHaveLength(1);

    const claimed = await org.claimPendingInvites({
      userId: "member_1",
      email: "member@example.com",
      name: "Member",
    });
    expect(claimed).toBe(1);
    expect(org.canActForSeller("member_1", "owner_1")).toBe(true);
    expect(org.staffRoleForSeller("member_1", "owner_1")).toBe("member");
  });

  it("blocks members from inviting", async () => {
    const org = await import("../src/pantryOrg.js");
    await org.ensureOwnerPantry({
      userId: "owner_1",
      email: "owner@example.com",
      name: "Owner",
    });
    await org.claimPendingInvites({
      userId: "member_1",
      email: "x@y.com",
      name: "M",
    });
    // Seed a membership without going through invite.
    dbHolder.db.pantryMemberships.push({
      id: "pmem_m",
      pantryId: dbHolder.db.pantries[0]!.id,
      userId: "member_1",
      role: "member",
      email: "member@example.com",
      name: "Member",
      firstName: "Member",
      lastName: null,
      phone: null,
      createdAt: "t0",
      updatedAt: "t0",
    });

    await expect(
      org.inviteByEmail("member_1", "other@example.com"),
    ).rejects.toMatchObject({ message: "pantry_required" });
  });
});
