import { SimulatedTransport } from "@relai-team/access-sdk";

/** Web never talks to physical hardware — sandbox simulation only. */
export function createSandboxTransport() {
  return new SimulatedTransport();
}
