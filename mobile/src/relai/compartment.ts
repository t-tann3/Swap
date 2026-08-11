import type { RelaiClient } from "@relai-team/access-sdk";

type RelaiNode = {
  id: string;
  size?: string | null;
  status?: string | null;
};

/**
 * Pick a free compartment at the Exchange Zone for Occupy unlock.
 * Sandbox nodes are labeled `standard` (not S/M/L); Relai returns
 * `no_node_available` if unlock does not match an available node.
 */
export async function resolveAvailableCompartment(
  relai: RelaiClient,
  exchangeZoneId: string,
): Promise<{ nodeId: string; size?: string }> {
  const ez = await relai.exchangeZones.get(exchangeZoneId);
  const towers = (ez as { towers?: { nodes?: RelaiNode[] }[] }).towers ?? [];
  const nodes = towers.flatMap(t => t.nodes ?? []);
  const available = nodes.filter(
    n => !n.status || n.status === "available",
  );

  if (available.length === 0) {
    throw Object.assign(
      new Error(
        "No free compartments at this Exchange Zone right now. Try again later or use a different zone on the next order.",
      ),
      { code: "no_node_available" },
    );
  }

  const node = available[0]!;
  return {
    nodeId: node.id,
    ...(node.size ? { size: node.size } : {}),
  };
}
