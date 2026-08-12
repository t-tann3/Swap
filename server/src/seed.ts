import type { Database, Listing } from "./types.js";

const now = () => new Date().toISOString();

/** Synthetic seller for seeded browse inventory (not a real Relai user). */
export const SEED_SELLER_USER_ID = "seed-seller-swap";

const SEED_SELLER = {
  userId: SEED_SELLER_USER_ID,
  email: "marketplace.demo@swap.local",
  name: "Swap Demo Seller",
};

function listing(
  partial: Omit<Listing, "sellerUserId" | "sellerEmail" | "sellerName" | "createdByUserId" | "createdAt" | "updatedAt" | "status" | "imageUrl" | "stockQty" | "maxPerOrder"> & {
    status?: Listing["status"];
    imageUrl?: string | null;
    stockQty?: number;
    maxPerOrder?: number;
  },
): Listing {
  const ts = now();
  return {
    sellerUserId: SEED_SELLER.userId,
    sellerEmail: SEED_SELLER.email,
    sellerName: SEED_SELLER.name,
    createdByUserId: SEED_SELLER.userId,
    status: partial.status ?? "available",
    imageUrl: partial.imageUrl ?? null,
    stockQty: partial.stockQty ?? 1,
    maxPerOrder: partial.maxPerOrder ?? 1,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function createSeedDatabase(): Database {
  const ts = now();
  return {
    profiles: [
      {
        userId: SEED_SELLER.userId,
        email: SEED_SELLER.email,
        name: SEED_SELLER.name,
        roles: ["seller"],
        bio: "Demo seller stocking sample marketplace inventory.",
        stripeAccountId: null,
        stripePayoutsReady: false,
        patronCap: null,
        isPantrySeller: true,
        pantryBlocked: false,
        adminOptOut: false,
        pushDevices: [],
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    listings: [
      listing({
        id: "lst-pantry-rice",
        title: "10lb bag of rice",
        description: "Unopened long-grain rice for pantry share.",
        priceCents: 0,
        category: "Pantry staples",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#D4A574",
      }),
      listing({
        id: "lst-pantry-beans",
        title: "Canned black beans (6-pack)",
        description: "Shelf-stable black beans.",
        priceCents: 0,
        category: "Canned & jarred",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#6B4F3A",
      }),
      listing({
        id: "lst-pantry-oats",
        title: "Rolled oats (42 oz)",
        description: "Unopened canister of whole-grain oats.",
        priceCents: 0,
        category: "Breakfast & cereal",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#C4A574",
      }),
      listing({
        id: "lst-pantry-milk",
        title: "Shelf-stable milk (1 qt)",
        description: "UHT milk, unopened.",
        priceCents: 0,
        category: "Dairy & eggs",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#F5F0E6",
      }),
      listing({
        id: "lst-pantry-pasta",
        title: "Spaghetti (2 lb)",
        description: "Dry pasta, sealed package.",
        priceCents: 0,
        category: "Pantry staples",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#E8C547",
      }),
      listing({
        id: "lst-pantry-applesauce",
        title: "Applesauce cups (6-pack)",
        description: "Unopened fruit cups for kids and families.",
        priceCents: 0,
        category: "Snacks",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#E07A5F",
      }),
      listing({
        id: "lst-pantry-formula",
        title: "Infant formula (sample tin)",
        description: "Sealed formula tin — check date before pickup.",
        priceCents: 0,
        category: "Baby & formula",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#8B9DC3",
      }),
      listing({
        id: "lst-pantry-soap",
        title: "Hand soap (2-pack)",
        description: "New bottles of liquid hand soap.",
        priceCents: 0,
        category: "Personal care",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#2D6A4F",
      }),
    ],
    orders: [],
    favorites: [],
    baskets: [],
    pantrySettings: {
      id: "default",
      enabled: false,
      defaultPatronCap: 5,
      hardReserveEnabled: true,
      basketHoldTtlMinutes: 120,
      lowStockThreshold: 3,
      updatedAt: ts,
    },
    stockAdjustments: [],
    pantries: [],
    pantryMemberships: [],
    pantryInvites: [],
    pantryPatrons: [],
    processedStripeEvents: [],
    processedRelaiEvents: [],
  };
}
