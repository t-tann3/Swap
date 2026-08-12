/** Canonical pantry categories — must match server/src/categories.ts */
export const LISTING_CATEGORIES = [
  "Produce",
  "Dairy & eggs",
  "Meat & seafood",
  "Bread & bakery",
  "Pantry staples",
  "Canned & jarred",
  "Breakfast & cereal",
  "Snacks",
  "Beverages",
  "Baby & formula",
  "Personal care",
  "Household",
  "Frozen",
  "Other",
] as const;

export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const DEFAULT_PANTRY_CATEGORY: ListingCategory = "Pantry staples";
