import { getMongoPing } from "./db.js";
import { log } from "./logger.js";
import { relaiSecretKey, relaiServerApiConfigured } from "./relai.js";
import { getStripe, paymentsEnabled, publishableKey } from "./stripe.js";
import { stripeWebhooksConfigured } from "./routes/stripeWebhook.js";
import { relaiWebhooksConfigured } from "./routes/relaiWebhook.js";
import { adminApiConfigured } from "./adminAuth.js";

export type CheckStatus = "ok" | "fail" | "skip";

export type DependencyCheck = {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
};

export type HealthReport = {
  ok: boolean;
  service: string;
  checks: {
    mongo: DependencyCheck;
    stripe: DependencyCheck;
    relai: DependencyCheck;
  };
  config: {
    paymentsEnabled: boolean;
    stripeWebhooksConfigured: boolean;
    relaiWebhooksConfigured: boolean;
    relaiServerApiConfigured: boolean;
    adminApiConfigured: boolean;
    stripePublishableConfigured: boolean;
  };
};

async function checkMongo(): Promise<DependencyCheck> {
  const started = Date.now();
  try {
    await getMongoPing();
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    log.warn("health_mongo_fail", {
      errMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkStripe(): Promise<DependencyCheck> {
  if (!paymentsEnabled()) {
    return { status: "skip", detail: "payments_disabled" };
  }
  const started = Date.now();
  try {
    await getStripe().balance.retrieve();
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    log.warn("health_stripe_fail", {
      errMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRelai(): Promise<DependencyCheck> {
  if (!relaiServerApiConfigured()) {
    return { status: "skip", detail: "relai_secret_unconfigured" };
  }
  const secret = relaiSecretKey()!;
  if (!secret.startsWith("sk_")) {
    return { status: "fail", detail: "invalid_relai_secret_format" };
  }
  // Connectivity probe — any HTTP response means the Relai edge is reachable.
  const started = Date.now();
  try {
    // Same host the app uses (auth.ts / Relai client), not api.relai.us.
    const res = await fetch("https://access.relai.us/", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return {
      status: "ok",
      latencyMs: Date.now() - started,
      detail: `http_${res.status}`,
    };
  } catch (err) {
    log.warn("health_relai_fail", {
      errMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function buildHealthReport(): Promise<HealthReport> {
  const [mongo, stripe, relai] = await Promise.all([
    checkMongo(),
    checkStripe(),
    checkRelai(),
  ]);

  const criticalFailed =
    mongo.status === "fail" ||
    (paymentsEnabled() && stripe.status === "fail");

  return {
    ok: !criticalFailed,
    service: "swap-server",
    checks: { mongo, stripe, relai },
    config: {
      paymentsEnabled: paymentsEnabled(),
      stripeWebhooksConfigured: stripeWebhooksConfigured(),
      relaiWebhooksConfigured: relaiWebhooksConfigured(),
      relaiServerApiConfigured: relaiServerApiConfigured(),
      adminApiConfigured: adminApiConfigured(),
      stripePublishableConfigured: Boolean(publishableKey()),
    },
  };
}
