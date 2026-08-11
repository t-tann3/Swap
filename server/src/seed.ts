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
  partial: Omit<Listing, "sellerUserId" | "sellerEmail" | "sellerName" | "createdAt" | "updatedAt" | "status"> & {
    status?: Listing["status"];
  },
): Listing {
  const ts = now();
  return {
    sellerUserId: SEED_SELLER.userId,
    sellerEmail: SEED_SELLER.email,
    sellerName: SEED_SELLER.name,
    status: partial.status ?? "available",
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
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    listings: [
      listing({
        id: "lst-pantry-rice",
        title: "10lb bag of rice",
        description:
          "Unopened long-grain rice. Great for a pantry share or neighborhood pickup.",
        priceCents: 800,
        category: "Food",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#D4A574",
      }),
      listing({
        id: "lst-pantry-beans",
        title: "Canned black beans (6-pack)",
        description: "Shelf-stable black beans. Ideal for food pantry swaps.",
        priceCents: 500,
        category: "Food",
        condition: "new",
        locationLabel: "Community Pantry Zone",
        imageColor: "#6B4F3A",
      }),
      listing({
        id: "lst-books-cookbook",
        title: "Neighborhood cookbook",
        description: "Gently used community cookbook with local recipes.",
        priceCents: 1200,
        category: "Books",
        condition: "good",
        locationLabel: "Library Exchange Zone",
        imageColor: "#C45C26",
      }),
      listing({
        id: "lst-clothes-jacket",
        title: "Winter jacket (M)",
        description: "Clean medium winter jacket. Soft shell, water resistant.",
        priceCents: 3500,
        category: "Clothing",
        condition: "like_new",
        locationLabel: "Campus Exchange Zone",
        imageColor: "#1F3A5F",
      }),
      listing({
        id: "lst-electronics-headphones",
        title: "Wireless headphones",
        description: "Over-ear Bluetooth headphones. Works great, minor wear on ear pads.",
        priceCents: 4500,
        category: "Electronics",
        condition: "good",
        locationLabel: "Downtown Exchange Zone",
        imageColor: "#222222",
      }),
      listing({
        id: "lst-home-lamp",
        title: "Desk lamp",
        description: "Adjustable LED desk lamp. Perfect for a dorm or home office.",
        priceCents: 1800,
        category: "Home",
        condition: "like_new",
        locationLabel: "Downtown Exchange Zone",
        imageColor: "#E8C547",
      }),
      listing({
        id: "lst-kids-blocks",
        title: "Wooden building blocks",
        description: "Set of 40 wooden blocks. Cleaned and ready for pickup.",
        priceCents: 1500,
        category: "Kids",
        condition: "good",
        locationLabel: "Family Exchange Zone",
        imageColor: "#E07A5F",
      }),
      listing({
        id: "lst-garden-herbs",
        title: "Fresh herb starter kit",
        description: "Basil, mint, and parsley starters in small pots.",
        priceCents: 900,
        category: "Garden",
        condition: "new",
        locationLabel: "Community Garden Zone",
        imageColor: "#2D6A4F",
      }),
    ],
    orders: [],
    favorites: [],
    processedStripeEvents: [],
  };
}
