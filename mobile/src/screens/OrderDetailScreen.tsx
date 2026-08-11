import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Order } from "../marketplace/types";
import { mediaUrl } from "../media/photos";
import type { OrdersStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<OrdersStackParamList, "OrderDetail">;

function isDropOffOverdue(order: Order): boolean {
  if (order.status !== "accepted" || !order.sellerDropOffDeadlineAt) return false;
  return Date.parse(order.sellerDropOffDeadlineAt) < Date.now();
}

function statusLabel(order: Order): string | null {
  const pantryOrder = order.priceCents === 0;
  switch (order.status) {
    case "pending_accept":
      return pantryOrder ? "Placed — waiting for pantry" : "Waiting for pantry";
    case "accepted":
      return pantryOrder
        ? "Accepted — pantry drop-off needed"
        : "Accepted — drop-off needed";
    case "ready_for_pickup":
      return null;
    case "completed":
      if (order.completedReason === "no_show") {
        return pantryOrder
          ? "Completed — no-show"
          : "Completed — neighbor no-show (paid to pantry)";
      }
      return null;
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

function orderLines(order: Order) {
  if (order.items && order.items.length > 0) return order.items;
  return [
    {
      listingId: order.listingId,
      quantity: 1,
      title: order.listing?.title ?? "Listing",
      listing: order.listing,
    },
  ];
}

function orderTitle(order: Order): string {
  const email = order.buyerEmail?.trim() || "Unknown";
  return `${email}'s Order Basket`;
}

function formatPickupBy(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrderDetailScreen({ navigation, route }: Props) {
  const { orderId } = route.params;
  const {
    profile,
    acceptOrder,
    cancelOrder,
    disputeOrder,
    showPrices,
    pantryMode,
    refresh,
  } = useMarketplace();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await apiRequest<Order>(`/api/orders/${orderId}`, {
        auth: true,
      });
      setOrder(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load order");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const isSeller = useMemo(
    () => Boolean(order && profile?.userId === order.sellerUserId),
    [order, profile?.userId],
  );

  function canDispute(o: Order): boolean {
    if (pantryMode || o.priceCents === 0) return false;
    if (o.platformDisputeOpenedAt || o.paymentStatus === "disputed") {
      return false;
    }
    return (
      o.status === "accepted" ||
      o.status === "ready_for_pickup" ||
      o.status === "completed"
    );
  }

  async function onAccept() {
    if (!order) return;
    try {
      await acceptOrder(order.id);
      await refresh();
      await load();
    } catch (err) {
      Alert.alert(
        "Could not accept",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  async function onCancel() {
    if (!order) return;
    try {
      await cancelOrder(order.id);
      await refresh();
      await load();
    } catch (err) {
      Alert.alert(
        "Could not cancel",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  function onDispute() {
    if (!order) return;
    Alert.prompt(
      "Open dispute",
      "After drop-off the item may be in a locker. Describe the issue — ops will refund or release after review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: (reason: string | undefined) => {
            const text = (reason ?? "").trim();
            if (text.length < 8) {
              Alert.alert("Need more detail", "Use at least 8 characters.");
              return;
            }
            void (async () => {
              try {
                await disputeOrder(order.id, text);
                await refresh();
                await load();
              } catch (err) {
                Alert.alert(
                  "Could not open dispute",
                  err instanceof Error ? err.message : "Unknown error",
                );
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
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

  const label = statusLabel(order);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{orderTitle(order)}</Text>
      <Text style={styles.orderId} selectable>
        Order ID: {order.id}
      </Text>

      {orderLines(order).length > 1
        ? orderLines(order).map(line => (
            <Text key={line.listingId} style={styles.meta}>
              {line.quantity}× {line.listing?.title ?? line.title}
            </Text>
          ))
        : null}

      {showPrices || label || (isSeller && isDropOffOverdue(order)) ? (
        <Text style={styles.meta}>
          {showPrices
            ? `$${(order.priceCents / 100).toFixed(2)}${label ? " · " : ""}`
            : ""}
          {label ?? ""}
          {isSeller && isDropOffOverdue(order) ? (
            <Text style={styles.overdue}> Overdue</Text>
          ) : null}
        </Text>
      ) : null}

      {order.exchangeZoneName ? (
        <Text style={styles.meta}>
          Exchange Zone: {order.exchangeZoneName}
          {order.exchangeZoneAddress ? ` · ${order.exchangeZoneAddress}` : ""}
        </Text>
      ) : null}

      {isSeller ? (
        <Text style={styles.meta}>
          Patron: {order.buyerEmail?.trim() || "Unknown"}
        </Text>
      ) : null}

      {order.status === "completed" &&
      order.completedReason !== "no_show" &&
      (order.relaiPickupVerifiedAt || order.completedAt) ? (
        <Text style={styles.meta}>
          Picked Up:{" "}
          {formatPickupBy(
            order.relaiPickupVerifiedAt ?? order.completedAt!,
          )}
        </Text>
      ) : null}

      {order.status === "ready_for_pickup" && order.pickupLinkExpiresAt ? (
        <Text style={styles.meta}>
          Pick up by {formatPickupBy(order.pickupLinkExpiresAt)}
          {showPrices && order.priceCents > 0
            ? " — after that, escrow releases to the pantry"
            : pantryMode || order.priceCents === 0
              ? " — after that the order may close as a no-show"
              : ""}
        </Text>
      ) : null}

      {order.dropOffPhotoUrl &&
      (order.status === "ready_for_pickup" || order.status === "completed") ? (
        <View style={styles.photoBox}>
          <Text style={styles.photoLabel}>Compartment photo</Text>
          <Image
            source={{ uri: mediaUrl(order.dropOffPhotoUrl)! }}
            style={styles.dropOffPhoto}
          />
        </View>
      ) : null}

      {(order.platformDisputeOpenedAt ||
        order.paymentStatus === "disputed") &&
      order.priceCents > 0 &&
      !pantryMode ? (
        <Text style={styles.disputeBanner}>
          Dispute open
          {order.platformDisputeReason ? `: ${order.platformDisputeReason}` : ""}
          . Escrow frozen until ops review.
        </Text>
      ) : null}

      <View style={styles.actions}>
        {isSeller && order.status === "pending_accept" ? (
          <Pressable style={styles.primary} onPress={() => void onAccept()}>
            <Text style={styles.primaryText}>Accept order</Text>
          </Pressable>
        ) : null}

        {isSeller && order.status === "accepted" ? (
          <Pressable
            style={styles.primary}
            onPress={() =>
              navigation.navigate("DropOff", { orderId: order.id })
            }>
            <Text style={styles.primaryText}>
              {order.priceCents === 0 ? "Drop off basket" : "Drop off item"}
            </Text>
          </Pressable>
        ) : null}

        {!isSeller && order.status === "ready_for_pickup" ? (
          <Pressable
            style={styles.primary}
            onPress={() =>
              navigation.navigate("Pickup", { orderId: order.id })
            }>
            <Text style={styles.primaryText}>
              {order.priceCents === 0 ? "Pick up basket" : "Pick up item"}
            </Text>
          </Pressable>
        ) : null}

        {(order.status === "pending_accept" ||
          order.status === "accepted") && (
          <Pressable style={styles.secondary} onPress={() => void onCancel()}>
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        )}

        {canDispute(order) ? (
          <Pressable style={styles.secondary} onPress={onDispute}>
            <Text style={styles.secondaryText}>Open dispute</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
  },
  content: {
    padding: 20,
    gap: 6,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f5f7",
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  orderId: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 8,
  },
  meta: {
    fontSize: 14,
    color: "#5c6370",
    lineHeight: 20,
  },
  overdue: {
    color: "#b45309",
    fontWeight: "700",
  },
  photoBox: {
    marginTop: 12,
  },
  photoLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5c6370",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  dropOffPhoto: {
    width: "100%",
    height: 180,
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
  },
  disputeBanner: {
    marginTop: 10,
    color: "#991b1b",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    marginTop: 16,
    gap: 10,
  },
  primary: {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondary: {
    backgroundColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 16,
  },
  error: {
    color: "#b91c1c",
    textAlign: "center",
  },
});
