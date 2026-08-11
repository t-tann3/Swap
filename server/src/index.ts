import "dotenv/config";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { adminApiConfigured } from "./adminAuth.js";
import { initDb } from "./db.js";
import { startEscrowScheduler } from "./escrow.js";
import { buildHealthReport } from "./health.js";
import { captureException, log } from "./logger.js";
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

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    if (req.path === "/health") return;
    log.info("http_request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });
  next();
});

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

app.get("/health", async (_req, res) => {
  const report = await buildHealthReport();
  res.status(report.ok ? 200 : 503).json(report);
});

app.use("/api", marketplaceRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);

app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    void captureException(err, { source: "express" });
    if (res.headersSent) return;
    res.status(500).json({
      code: "internal_error",
      message: "Unexpected server error.",
    });
  },
);

await ensureUploadsDir();
await initDb();
startEscrowScheduler();

app.listen(port, () => {
  log.info("server_listening", {
    port,
    paymentsEnabled: paymentsEnabled(),
    stripeWebhooksConfigured: stripeWebhooksConfigured(),
    relaiWebhooksConfigured: relaiWebhooksConfigured(),
    relaiServerApiConfigured: relaiServerApiConfigured(),
    adminApiConfigured: adminApiConfigured(),
  });
});
