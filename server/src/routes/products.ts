import { Router } from "express";

import { requireAuth } from "../auth.js";
import { isPantryMode } from "../pantry.js";
import {
  isValidBarcode,
  lookupBarcodeProduct,
} from "../productLookup.js";

export const productsRouter = Router();

/**
 * Pantry barcode → catalog draft (Open Food Facts + ingested image).
 * GET /api/products/barcode/:code
 */
productsRouter.get("/products/barcode/:code", requireAuth, async (req, res) => {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Barcode lookup is only available in pantry mode.",
    });
    return;
  }

  const code = String(req.params.code ?? "");
  if (!isValidBarcode(code)) {
    res.status(400).json({
      code: "invalid_barcode",
      message: "Enter an 8–14 digit barcode (UPC/EAN).",
    });
    return;
  }

  try {
    const product = await lookupBarcodeProduct(code);
    if (!product) {
      res.status(404).json({
        code: "not_found",
        message:
          "No catalog match for that barcode. Enter the title manually or try another code.",
      });
      return;
    }
    res.json(product);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const codeName = (err as Error).message;
    res.status(status).json({
      code: codeName,
      message:
        codeName === "invalid_barcode"
          ? "Enter an 8–14 digit barcode (UPC/EAN)."
          : codeName === "lookup_failed"
            ? "Catalog lookup failed. Try again in a moment."
            : "Could not look up that barcode.",
    });
  }
});
