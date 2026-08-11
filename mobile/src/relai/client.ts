import { RelaiClient } from "@relai-team/access-sdk";
import { RELAI_PUBLISHABLE_KEY } from "@env";

import { tokenStorage } from "./tokenStorage";

const publishableKey = RELAI_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error(
    "Missing RELAI_PUBLISHABLE_KEY. Copy mobile/.env.example to mobile/.env and set your sandbox pk_ key.",
  );
}

if (!publishableKey.startsWith("pk_")) {
  throw new Error(
    "RELAI_PUBLISHABLE_KEY must be a publishable key (pk_…). Secret keys (sk_…) must never ship in the app.",
  );
}

let client: RelaiClient | null = null;
let ready: Promise<RelaiClient> | null = null;

/** Hydrate the persisted session, then return the shared RelaiClient. */
export function initRelai(): Promise<RelaiClient> {
  if (client) {
    return Promise.resolve(client);
  }
  if (!ready) {
    ready = (async () => {
      await tokenStorage.hydrate();
      client = new RelaiClient({
        publishableKey,
        tokenStorage,
      });
      return client;
    })();
  }
  return ready;
}

/** Shared Relai Access client. Call `initRelai()` first. */
export function getRelai(): RelaiClient {
  if (!client) {
    throw new Error("Relai client not ready. Await initRelai() first.");
  }
  return client;
}
