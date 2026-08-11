import { Intents, RelaiApiError } from "@relai-team/access-sdk";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Order } from "../marketplace/types";
import { mediaUrl, pickAndUploadPhoto } from "../media/photos";
import { getRelai } from "../relai/client";
import { resolveAvailableCompartment } from "../relai/compartment";
import { createSandboxTransport } from "../relai/transport";

type Props = {
  route: { params: { orderId: string } };
  navigation: { goBack: () => void };
};

function describeDropOffError(err: unknown, pantryOrder = false): string {
  if (err instanceof RelaiApiError) {
    if (err.code === "invalid_request") {
      return (
        "Relai rejected open handoff for this app. In the Relai portal, open " +
        "your sandbox app → Handoff modes → enable Open (required for a " +
        "shareable pickup link). Save, then try drop-off again."
      );
    }
    if (err.code === "payment_required") {
      return pantryOrder
        ? "Relai is charging at the door. In the Relai portal, set Payment mode to App-managed so compartment opens are not payment-gated, then try drop-off again."
        : "Relai is charging at the door (Relai checkout mode). Swap already " +
          "authorized the buyer via Stripe escrow — that does not pay Relai. " +
          "In the Relai portal, set Payment mode to App-managed so compartment " +
          "opens are not payment-gated, then try drop-off again.";
    }
    if (err.code === "no_node_available") {
      return (
        "Relai has no matching free compartment at this Exchange Zone. " +
        "Sandbox doors are usually labeled “standard”. Try again, or place a " +
        "new order at a zone that shows compartments available at checkout."
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [dropOffPhotoUrl, setDropOffPhotoUrl] = useState<string | null>(null);
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

  async function onSnapCompartment(source: "camera" | "library" = "camera") {
    setPhotoBusy(true);
    setError(null);
    try {
      const url = await pickAndUploadPhoto(source);
      if (url) setDropOffPhotoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo failed");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onDropOff() {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    try {
      const relai = getRelai();
      const compartment = await resolveAvailableCompartment(
        relai,
        order.exchangeZoneId,
      );
      const relaiOrder = await relai.orders.create({
        exchangeZoneId: order.exchangeZoneId,
        handoffMode: "open",
      });

      const transport = createSandboxTransport();
      const result = await relai.unlock({
        orderId: relaiOrder.id,
        intent: Intents.Occupy,
        transport,
        nodeId: compartment.nodeId,
        ...(compartment.size ? { size: compartment.size } : {}),
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
        dropOffPhotoUrl,
      });

      Alert.alert(
        "Dropped off",
        dropOffPhotoUrl
          ? "Pickup link and compartment photo saved. The buyer can view them under Ready for Pickup."
          : "Pickup link saved. The buyer can view it under Ready for Pickup.",
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      setError(describeDropOffError(err, order.priceCents === 0));
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

  const previewUri = mediaUrl(dropOffPhotoUrl);

  const isPantryBasket = order.priceCents === 0;
  const lines =
    order.items && order.items.length > 0
      ? order.items
      : [
          {
            listingId: order.listingId,
            quantity: 1,
            title: order.listing?.title ?? "Item",
          },
        ];
  const headingTitle =
    isPantryBasket && lines.length > 1
      ? `Basket · ${lines.length} items`
      : (lines[0]?.title ?? order.listing?.title ?? "Order");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>
        {isPantryBasket ? "Drop off basket" : "Drop off"}
      </Text>
      <Text style={styles.title}>{headingTitle}</Text>
      {isPantryBasket && lines.length > 1
        ? lines.map(line => (
            <Text key={line.listingId} style={styles.meta}>
              {line.quantity}× {line.title}
            </Text>
          ))
        : null}
      <Text style={styles.meta}>
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </Text>
      <Text style={styles.body}>
        {isPantryBasket
          ? "Open a compartment and place the full basket inside. A compartment photo is optional (useful on a real device; the simulator has no camera). Swap attaches the one-time pickup link for the buyer."
          : "Open a compartment and place the item inside. A compartment photo is optional (useful on a real device; the simulator has no camera). Swap attaches the one-time pickup link for the buyer."}
      </Text>

      <Text style={styles.label}>Compartment photo (optional)</Text>
      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} />
      ) : (
        <View style={styles.previewEmpty}>
          <Text style={styles.previewEmptyText}>No photo yet</Text>
        </View>
      )}
      <View style={styles.photoRow}>
        <Pressable
          style={[
            styles.secondary,
            styles.photoBtn,
            (photoBusy || busy) && styles.buttonDisabled,
          ]}
          disabled={photoBusy || busy || order.status !== "accepted"}
          onPress={() => void onSnapCompartment("camera")}>
          <Text style={styles.secondaryText}>
            {dropOffPhotoUrl ? "Retake" : "Camera"}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.secondary,
            styles.photoBtn,
            (photoBusy || busy) && styles.buttonDisabled,
          ]}
          disabled={photoBusy || busy || order.status !== "accepted"}
          onPress={() => void onSnapCompartment("library")}>
          <Text style={styles.secondaryText}>Choose photo</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        disabled={busy || photoBusy || order.status !== "accepted"}
        onPress={() => void onDropOff()}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Open compartment & drop off</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
  },
  content: {
    padding: 24,
    paddingBottom: 40,
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
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111827",
  },
  preview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#e5e7eb",
  },
  previewEmpty: {
    width: "100%",
    height: 140,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  previewEmptyText: {
    color: "#6b7280",
    fontSize: 14,
  },
  secondary: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 16,
  },
  photoRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  photoBtn: {
    flex: 1,
    marginBottom: 0,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
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
