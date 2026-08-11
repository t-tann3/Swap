/** Must match server/src/compartmentSizes.ts — Relai Full Tower limits. */
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

export function formatCompartmentSize(id: string | null | undefined): string {
  const found = COMPARTMENT_SIZES.find(s => s.id === id);
  if (!found) return "Size ?";
  return `${found.label} (≤ ${found.maxHeightIn}×${found.maxWidthIn}×${found.maxDepthIn}")`;
}
