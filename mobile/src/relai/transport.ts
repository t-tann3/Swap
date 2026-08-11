import { SimulatedTransport } from "@relai-team/access-sdk";

/** Sandbox transport — no hardware required. */
export function createSandboxTransport() {
  return new SimulatedTransport();
}
