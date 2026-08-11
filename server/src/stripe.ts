import Stripe from "stripe";

let stripe: Stripe | null = null;

/**
 * Commerce / escrow kill switch.
 * - PAYMENTS_ENABLED=false → no Stripe UI, no authorize/capture (food pantry / free swap)
 * - otherwise requires STRIPE_SECRET_KEY=sk_…
 */
export function paymentsEnabled(): boolean {
  const flag = (process.env.PAYMENTS_ENABLED ?? "true").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  return Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_"));
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_")) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!stripe) {
    stripe = new Stripe(key);
  }
  return stripe;
}

/** Platform fee in basis points (default 10%). */
export function platformFeeBps(): number {
  const raw = Number(process.env.STRIPE_PLATFORM_FEE_BPS ?? "1000");
  if (!Number.isFinite(raw) || raw < 0 || raw >= 10_000) return 1000;
  return Math.floor(raw);
}

export function sellerTransferCents(priceCents: number): {
  feeCents: number;
  transferCents: number;
} {
  const feeCents = Math.min(
    priceCents,
    Math.floor((priceCents * platformFeeBps()) / 10_000),
  );
  return { feeCents, transferCents: priceCents - feeCents };
}

export function publishableKey(): string | null {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  return key?.startsWith("pk_") ? key : null;
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}
