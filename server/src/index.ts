import "dotenv/config";
import cors from "cors";
import express from "express";

import { adminApiConfigured } from "./adminAuth.js";
import { initDb } from "./db.js";
import { startEscrowScheduler } from "./escrow.js";
import { adminRouter } from "./routes/admin.js";
import { marketplaceRouter } from "./routes/marketplace.js";
import { paymentsRouter } from "./routes/payments.js";
import {
  relaiWebhookRouter,
  relaiWebhooksConfigured,
} from "./routes/relaiWebhook.js";
import {
  stripeWebhookRouter,
  stripeWebhooksConfigured,
} from "./routes/stripeWebhook.js";
import { uploadsRouter } from "./routes/uploads.js";
import { relaiServerApiConfigured } from "./relai.js";
import { paymentsEnabled } from "./stripe.js";
import { ensureUploadsDir, uploadsDir } from "./uploads.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());

// Stripe / Relai signature verification needs the raw body — mount before JSON parser.
app.use(
  "/api/payments/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter,
);
app.use(
  "/api/relai/webhooks",
  express.raw({ type: "application/json" }),
  relaiWebhookRouter,
);

// Base64 photo uploads can be large; keep under ~3MB encoded.
app.use(express.json({ limit: "4mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", uploadsRouter);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "swap-server",
    paymentsEnabled: paymentsEnabled(),
    stripeWebhooksConfigured: stripeWebhooksConfigured(),
    relaiWebhooksConfigured: relaiWebhooksConfigured(),
    relaiServerApiConfigured: relaiServerApiConfigured(),
    adminApiConfigured: adminApiConfigured(),
  });
});

app.use("/api", marketplaceRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);

await ensureUploadsDir();
await initDb();
startEscrowScheduler();

app.listen(port, () => {
  console.log(`Swap server listening on http://localhost:${port}`);
  if (!paymentsEnabled()) {
    console.log(
      "Payments off (non-monetary mode). Set PAYMENTS_ENABLED=true and STRIPE_SECRET_KEY=sk_… for escrow.",
    );
  } else if (!stripeWebhooksConfigured()) {
    console.log(
      "Stripe webhooks not configured. Set STRIPE_WEBHOOK_SECRET (stripe listen --forward-to localhost:4000/api/payments/webhooks/stripe).",
    );
  }
  if (!relaiWebhooksConfigured()) {
    console.log(
      "Relai webhooks not configured. Set RELAI_WEBHOOK_SECRET and point the Relai portal at /api/relai/webhooks.",
    );
  }
  if (!relaiServerApiConfigured()) {
    console.log(
      "Relai server API not configured. Set RELAI_SECRET_KEY so /complete can poll Relai when webhooks are delayed.",
    );
  }
  if (!adminApiConfigured()) {
    console.log(
      "Admin role not configured. Set ADMIN_USER_IDS or ADMIN_EMAILS (Relai ids/emails) for dispute/ops console.",
    );
  }
});
