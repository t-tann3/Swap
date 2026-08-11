/**
 * Relai Exchange Zone Full Tower capacity (platform catalog constraint).
 * Exterior: 76" H × 37.5" W × 23" D, 18 doors / 2 columns.
 * Every Swap listing must fit a compartment; nothing larger than Large.
 *
 * `relaiSize` is passed to Relai unlock so the platform opens a matching door.
 */
export const COMPARTMENT_SIZES = [
  {
    id: "S",
    label: "Small",
    relaiSize: "S",
    maxHeightIn: 6,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Slim door — books, cans, small packages",
  },
  {
    id: "M",
    label: "Medium",
    relaiSize: "M",
    maxHeightIn: 12,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Standard door — clothing folds, headphones, desk items",
  },
  {
    id: "L",
    label: "Large",
    relaiSize: "L",
    maxHeightIn: 24,
    maxWidthIn: 16,
    maxDepthIn: 21,
    description: "Tall door — jackets, larger boxes (still ≤ 21\" deep)",
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
