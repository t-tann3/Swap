import { Intents, RelaiApiError } from "@relai-team/access-sdk";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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

export function PickupScreen({ route, navigation }: Props) {
  const { completeOrder } = useMarketplace();
  const [order, setOrder] = useState<Order | null>(null);
  const [linkCode, setLinkCode] = useState("");
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
        if (!cancelled) {
          setOrder(data);
          setLinkCode(data.pickupLinkCode ?? "");
        }
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

  async function onPickup() {
    const code = linkCode.trim();
    if (!order || !code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const relai = getRelai();
      const transport = createSandboxTransport();
      const target = await relai.accessLinks.resolve(code);
      await relai.unlock({
        orderId: target.order_id,
        intent: Intents.MakeAvailable,
        accessLink: code,
        transport,
      });
      await completeOrder(order.id);
      Alert.alert("Picked up", "Order complete. The compartment is free again.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      if (err instanceof RelaiApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : "Pick-up failed");
      }
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
      <Text style={styles.heading}>Pick up</Text>
      <Text style={styles.title}>{order.listing?.title ?? "Order"}</Text>
      <Text style={styles.meta}>
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </Text>

      <Text style={styles.label}>Pickup link</Text>
      <Text style={styles.help}>
        Attached by the seller after drop-off. Paste a `relai.access…` code here
        if you copied it from Orders.
      </Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="relai.access…"
        value={linkCode}
        onChangeText={setLinkCode}
        editable={!busy}
      />
      {order.pickupLinkExpiresAt ? (
        <Text style={styles.meta}>
          Expires {new Date(order.pickupLinkExpiresAt).toLocaleString()}
        </Text>
      ) : null}

      <Text style={styles.body}>
        {order.priceCents === 0
          ? "Resolves the open-handoff link and opens the compartment (sandbox simulated transport). Completing pickup finishes the order. If you miss the deadline, the order may close as a no-show."
          : "Resolves the open-handoff link and opens the compartment (sandbox simulated transport). Completing pickup releases escrow to the seller. If you miss the deadline, funds still release to the seller as a no-show."}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        disabled={busy || !linkCode.trim()}
        onPress={() => void onPickup()}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Open compartment & pick up</Text>
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
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#5c6370",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  help: {
    fontSize: 13,
    color: "#5c6370",
    lineHeight: 18,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    fontFamily: "Menlo",
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
    marginBottom: 20,
  },
  error: {
    color: "#b42318",
    marginBottom: 12,
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
