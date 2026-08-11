import "dotenv/config";
import cors from "cors";
import express from "express";

import { initDb } from "./db.js";
import { startEscrowScheduler } from "./escrow.js";
import { marketplaceRouter } from "./routes/marketplace.js";
import { paymentsRouter } from "./routes/payments.js";
import {
  stripeWebhookRouter,
  stripeWebhooksConfigured,
} from "./routes/stripeWebhook.js";
import { paymentsEnabled } from "./stripe.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());

// Stripe signature verification needs the raw body — mount before JSON parser.
app.use(
  "/api/payments/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter,
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "swap-server",
    paymentsEnabled: paymentsEnabled(),
    stripeWebhooksConfigured: stripeWebhooksConfigured(),
  });
});

app.use("/api", marketplaceRouter);
app.use("/api/payments", paymentsRouter);

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
});
