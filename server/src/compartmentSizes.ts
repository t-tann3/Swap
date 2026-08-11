/**
 * Relai Exchange Zone Full Tower capacity (platform catalog constraint).
 * Exterior: 76" H × 37.5" W × 23" D, 18 doors / 2 columns.
 * Every Swap listing must fit a compartment; nothing larger than Large.
 *
 * User-facing copy uses everyday references (carry-on suitcases).
 * Numeric max dims stay for internal validation / Relai size mapping.
 *
 * `relaiSize` is passed to Relai unlock so the platform opens a matching door.
 */
export const COMPARTMENT_SIZES = [
  {
    id: "S",
    label: "Small",
    relaiSize: "S",
    /** Shown to sellers/buyers instead of inch dimensions. */
    fitGuide: "About a backpack or shoe box",
    maxHeightIn: 6,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Slim door — books, cans, small packages",
  },
  {
    id: "M",
    label: "Medium",
    relaiSize: "M",
    fitGuide: "About 1 carry-on suitcase",
    maxHeightIn: 12,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Standard door — clothing, headphones, desk items",
  },
  {
    id: "L",
    label: "Large",
    relaiSize: "L",
    fitGuide: "About 2 carry-on suitcases",
    maxHeightIn: 24,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Tall door — jackets and larger boxes that still fit a door",
  },
] as const;

export type CompartmentSizeId = (typeof COMPARTMENT_SIZES)[number]["id"];

export const COMPARTMENT_SIZE_IDS = COMPARTMENT_SIZES.map(s => s.id);

/** Hard platform limits — largest Full Tower door. */
export const MAX_ITEM_DIMENSIONS_IN = {
  height: 24,
  width: 16,
  depth: 21,
} as const;

export function isCompartmentSizeId(value: string): value is CompartmentSizeId {
  return (COMPARTMENT_SIZE_IDS as readonly string[]).includes(value);
}

export function getCompartmentSize(id: CompartmentSizeId) {
  return COMPARTMENT_SIZES.find(s => s.id === id)!;
}

export function relaiSizeForCompartment(id: CompartmentSizeId): string {
  return getCompartmentSize(id).relaiSize;
}
