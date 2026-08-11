import { describe, expect, it } from "vitest";

import { isValidBarcode } from "../src/productLookup.js";

describe("barcode validation", () => {
  it("accepts UPC/EAN digit lengths", () => {
    expect(isValidBarcode("01234567")).toBe(true);
    expect(isValidBarcode("012345678905")).toBe(true);
    expect(isValidBarcode("123")).toBe(false);
    expect(isValidBarcode("abc")).toBe(false);
  });
});
