/** Canonical marketplace categories — must match server/src/categories.ts */
export const LISTING_CATEGORIES = [
  "Food",
  "Books",
  "Clothing",
  "Electronics",
  "Home",
  "Kids",
  "Garden",
  "General",
] as const;

export type ListingCategory = (typeof LISTING_CATEGORIES)[number];
