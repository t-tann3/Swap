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
