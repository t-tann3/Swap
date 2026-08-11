import { Intents, RelaiApiError } from "@relai-team/access-sdk";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Order } from "../marketplace/types";
import { getRelai } from "../relai/client";
import { createSandboxTransport } from "../relai/transport";

type Props = {
  route: { params: { orderId: string } };
  navigation: { goBack: () => void };
};

function describeDropOffError(err: unknown): string {
  if (err instanceof RelaiApiError) {
    if (err.code === "invalid_request") {
      return (
        "Relai rejected open handoff for this app. In the Relai portal, open " +
        "your sandbox app → Handoff modes → enable Open (required for a " +
        "shareable pickup link). Save, then try drop-off again."
      );
    }
    if (err.code === "payment_required") {
      return (
        "Relai is charging at the door (Relai checkout mode). Swap already " +
        "authorized the buyer via Stripe escrow — that does not pay Relai. " +
        "In the Relai portal, set Payment mode to App-managed so compartment " +
        "opens are not payment-gated, then try drop-off again."
      );
    }
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : "Drop-off failed";
}

export function DropOffScreen({ route, navigation }: Props) {
  const { recordDropOff } = useMarketplace();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<Order>(
          `/api/orders/${route.params.orderId}`,
          { auth: true },
        );
        if (!cancelled) setOrder(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load order");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.params.orderId]);

  async function onDropOff() {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    try {
      const relai = getRelai();
      // Marketplace handoffs are always open-mode: drop-off mints a single-use
      // access link that we attach to the marketplace order for the buyer.
      const relaiOrder = await relai.orders.create({
        exchangeZoneId: order.exchangeZoneId,
        handoffMode: "open",
      });

      const transport = createSandboxTransport();
      const result = await relai.unlock({
        orderId: relaiOrder.id,
        intent: Intents.Occupy,
        transport,
      });

      const link = result.open.access_link;
      if (!link?.code) {
        throw new Error(
          "Drop-off succeeded but Relai returned no access link. Confirm Open handoff is enabled in the Relai portal.",
        );
      }

      await recordDropOff(order.id, {
        relaiOrderId: relaiOrder.id,
        pickupLinkCode: link.code,
        pickupLinkExpiresAt: link.expires_at,
      });

      Alert.alert(
        "Dropped off",
        "Pickup link saved on this order. The buyer can view it under Ready for Pickup and paste it to collect.",
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      setError(describeDropOffError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Order not found."}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Drop off</Text>
      <Text style={styles.title}>{order.listing?.title ?? "Order"}</Text>
      <Text style={styles.meta}>
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </Text>
      <Text style={styles.body}>
        Creates a Relai open-handoff order, opens a compartment (sandbox
        simulated transport), and attaches the one-time pickup link to this
        marketplace order for the buyer.
      </Text>
      <Text style={styles.hint}>
        Requires Open handoff enabled on your Relai sandbox app in the portal.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        disabled={busy || order.status !== "accepted"}
        onPress={() => void onDropOff()}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Open compartment & drop off</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f4f5f7",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  meta: {
    fontSize: 14,
    color: "#5c6370",
    marginBottom: 16,
    lineHeight: 20,
  },
  body: {
    fontSize: 15,
    color: "#414651",
    lineHeight: 22,
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    color: "#5c6370",
    lineHeight: 18,
    marginBottom: 20,
  },
  error: {
    color: "#b42318",
    marginBottom: 12,
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
