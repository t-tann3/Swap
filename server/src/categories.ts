/** Pantry aisle categories used for listings in pantry mode. */
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

export function isListingCategory(value: string): value is ListingCategory {
  return (LISTING_CATEGORIES as readonly string[]).includes(value);
}

/** Default aisle when a barcode lookup has no better match. */
export const DEFAULT_PANTRY_CATEGORY: ListingCategory = "Pantry staples";
