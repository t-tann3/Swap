import { RelaiClient } from "@relai-team/access-sdk";

/** Server-only Relai secret (`sk_…`). Never ship in clients. */
export function relaiSecretKey(): string | undefined {
  return process.env.RELAI_SECRET_KEY?.trim() || undefined;
}

export function relaiWebhookSecret(): string | undefined {
  return process.env.RELAI_WEBHOOK_SECRET?.trim() || undefined;
}

export function relaiWebhooksConfigured(): boolean {
  return Boolean(relaiWebhookSecret());
}

export function relaiServerApiConfigured(): boolean {
  return Boolean(relaiSecretKey());
}

let client: RelaiClient | null = null;

/** Relai client authenticated with the app secret key (server-side only). */
export function getRelaiServerClient(): RelaiClient {
  const secretKey = relaiSecretKey();
  if (!secretKey) {
    throw Object.assign(new Error("relai_secret_unconfigured"), { status: 503 });
  }
  if (!client) {
    client = new RelaiClient({ secretKey });
  }
  return client;
}

/**
 * Fetch Relai order status with the secret key.
 * Used as a fallback when the buyer hits /complete before/without a webhook.
 */
export async function fetchRelaiOrderStatus(
  relaiOrderId: string,
): Promise<"open" | "completed" | "cancelled" | "refunded"> {
  const relai = getRelaiServerClient();
  const order = await relai.orders.get(relaiOrderId);
  return order.status;
}
