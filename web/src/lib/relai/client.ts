import { RelaiClient } from "@relai-team/access-sdk";

import { tokenStorage } from "./tokenStorage";

const publishableKey = process.env.NEXT_PUBLIC_RELAI_PUBLISHABLE_KEY;

if (!publishableKey?.startsWith("pk_")) {
  // Soft-fail at module load in SSR; runtime checks throw clearer errors.
  console.warn(
    "Missing NEXT_PUBLIC_RELAI_PUBLISHABLE_KEY (must be a pk_ key).",
  );
}

let client: RelaiClient | null = null;

/** Browser → same-origin proxy (avoids Relai CORS). Server → Relai directly. */
function relaiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/relai`;
  }
  return "https://access.relai.us/api/v1";
}

export function initRelai(): RelaiClient {
  if (client) return client;
  if (!publishableKey?.startsWith("pk_")) {
    throw new Error(
      "Missing NEXT_PUBLIC_RELAI_PUBLISHABLE_KEY. Copy web/.env.example to web/.env.local.",
    );
  }
  tokenStorage.hydrate();
  client = new RelaiClient({
    publishableKey,
    tokenStorage,
    baseUrl: relaiBaseUrl(),
    // SDK may call a stored fetch reference; browsers require the Window binding.
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  return client;
}

export function getRelai(): RelaiClient {
  if (!client) return initRelai();
  return client;
}
