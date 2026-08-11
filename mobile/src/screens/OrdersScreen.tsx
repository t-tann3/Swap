import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Order } from "../marketplace/types";
import { mediaUrl } from "../media/photos";
import type { OrdersStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<OrdersStackParamList, "OrdersHome">;

type StatusBucket = "placed" | "accepted" | "ready_for_pickup" | "completed";

const STATUS_BUCKETS: {
  id: StatusBucket;
  label: string;
  emptyBuying: string;
  emptySelling: string;
  statuses: Order["status"][];
}[] = [
  {
    id: "placed",
    label: "Placed",
    emptyBuying: "No placed orders waiting on a seller.",
    emptySelling: "No new orders to accept.",
    statuses: ["pending_accept"],
  },
  {
    id: "accepted",
    label: "Accepted",
    emptyBuying: "No accepted orders yet.",
    emptySelling: "No accepted orders waiting for drop-off.",
    statuses: ["accepted"],
  },
  {
    id: "ready_for_pickup",
    label: "Ready for Pickup",
    emptyBuying: "Nothing ready for pickup.",
    emptySelling: "No orders waiting on buyer pickup.",
    statuses: ["ready_for_pickup"],
  },
  {
    id: "completed",
    label: "Completed",
    emptyBuying: "No completed orders yet.",
    emptySelling: "No completed sales yet.",
    statuses: ["completed"],
  },
];

function statusLabel(order: Order): string {
  switch (order.status) {
    case "pending_accept":
      return "Waiting for seller";
    case "accepted":
      return "Accepted — drop-off needed";
    case "ready_for_pickup":
      return "Ready for pickup";
    case "completed":
      return order.completedReason === "no_show"
        ? "Completed — buyer no-show (paid to seller)"
        : "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

export function OrdersScreen({ navigation }: Props) {
  const {
    ordersAsBuyer,
    ordersAsSeller,
    profile,
    acceptOrder,
    cancelOrder,
    disputeOrder,
    refresh,
    refreshing,
    showPrices,
  } = useMarketplace();

  const isBuyer = profile?.roles.includes("buyer") ?? false;
  const isSellerRole = profile?.roles.includes("seller") ?? false;
  const showRoleTabs = isBuyer && isSellerRole;

  const [tab, setTab] = useState<"buying" | "selling">(() =>
    isSellerRole && !isBuyer ? "selling" : "buying",
  );
  const [statusBucket, setStatusBucket] = useState<StatusBucket>("placed");

  const refreshOnFocus = useCallback(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(refreshOnFocus);

  // Keep role tab valid when roles change (e.g. seller-only ↔ buyer-only).
  const roleTab: "buying" | "selling" = showRoleTabs
    ? tab
    : isSellerRole && !isBuyer
      ? "selling"
      : "buying";

  const activeBucket =
    STATUS_BUCKETS.find(b => b.id === statusBucket) ?? STATUS_BUCKETS[0]!;

  const roleOrders = roleTab === "selling" ? ordersAsSeller : ordersAsBuyer;
  const data = roleOrders.filter(o =>
    activeBucket.statuses.includes(o.status),
  );

  async function onAccept(order: Order) {
    try {
      await acceptOrder(order.id);
    } catch (err) {
      Alert.alert(
        "Could not accept",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  async function onCancel(order: Order) {
    try {
      await cancelOrder(order.id);
    } catch (err) {
      Alert.alert(
        "Could not cancel",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  function onDispute(order: Order) {
    Alert.prompt(
      "Open dispute",
      "After drop-off the item may be in a locker. Describe the issue — ops will refund or release after review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: reason => {
            const text = (reason ?? "").trim();
            if (text.length < 8) {
              Alert.alert("Need more detail", "Use at least 8 characters.");
              return;
            }
            void (async () => {
              try {
                await disputeOrder(order.id, text);
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

  function canDispute(order: Order): boolean {
    if (order.platformDisputeOpenedAt || order.paymentStatus === "disputed") {
      return false;
    }
    return (
      order.status === "accepted" ||
      order.status === "ready_for_pickup" ||
      order.status === "completed"
    );
  }

  return (
    <View style={styles.container}>
      {showRoleTabs ? (
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, roleTab === "buying" && styles.tabOn]}
            onPress={() => setTab("buying")}>
            <Text
              style={[
                styles.tabText,
                roleTab === "buying" && styles.tabTextOn,
              ]}>
              Buying
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, roleTab === "selling" && styles.tabOn]}
            onPress={() => setTab("selling")}>
            <Text
              style={[
                styles.tabText,
                roleTab === "selling" && styles.tabTextOn,
              ]}>
              Selling
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.subTabs}>
        {STATUS_BUCKETS.map(bucket => {
          const count = roleOrders.filter(o =>
            bucket.statuses.includes(o.status),
          ).length;
          const on = statusBucket === bucket.id;
          return (
            <Pressable
              key={bucket.id}
              style={[styles.subTab, on && styles.subTabOn]}
              onPress={() => setStatusBucket(bucket.id)}>
              <Text
                style={[styles.subTabText, on && styles.subTabTextOn]}
                numberOfLines={1}>
                {bucket.label}
                {count > 0 ? ` (${count})` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={data}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
        contentContainerStyle={
          data.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={
          <Text style={styles.emptyBody}>
            {roleTab === "selling"
              ? activeBucket.emptySelling
              : activeBucket.emptyBuying}
          </Text>
        }
        renderItem={({ item }) => {
          // Selling tab = seller actions. Seed demo orders may still list
          // sellerUserId as the synthetic seed seller until accept adopts them.
          const isSeller = roleTab === "selling";
          return (
            <View style={styles.card}>
              <Text style={styles.title}>
                {item.listing?.title ?? "Listing"}
              </Text>
              <Text style={styles.meta}>
                {showPrices
                  ? `$${(item.priceCents / 100).toFixed(2)} · `
                  : ""}
                {statusLabel(item)}
              </Text>
              {item.exchangeZoneName ? (
                <Text style={styles.meta}>
                  Exchange Zone: {item.exchangeZoneName}
                  {item.exchangeZoneAddress
                    ? ` · ${item.exchangeZoneAddress}`
                    : ""}
                </Text>
              ) : null}
              {item.status === "ready_for_pickup" && item.pickupLinkExpiresAt ? (
                <Text style={styles.meta}>
                  Pick up by {new Date(item.pickupLinkExpiresAt).toLocaleString()}
                  {showPrices
                    ? " — after that, escrow releases to the seller"
                    : ""}
                </Text>
              ) : null}

              {item.status === "ready_for_pickup" && item.pickupLinkCode ? (
                <View style={styles.linkBox}>
                  <Text style={styles.linkLabel}>Pickup link</Text>
                  <Text style={styles.linkCode} selectable>
                    {item.pickupLinkCode}
                  </Text>
                  {!isSeller ? (
                    <Text style={styles.linkHint}>
                      Long-press to copy, then open Pick up and paste if needed.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {item.dropOffPhotoUrl &&
              (item.status === "ready_for_pickup" ||
                item.status === "completed") ? (
                <View style={styles.photoBox}>
                  <Text style={styles.linkLabel}>Compartment photo</Text>
                  <Image
                    source={{ uri: mediaUrl(item.dropOffPhotoUrl)! }}
                    style={styles.dropOffPhoto}
                  />
                </View>
              ) : null}

              {item.platformDisputeOpenedAt ||
              item.paymentStatus === "disputed" ? (
                <Text style={styles.disputeBanner}>
                  Dispute open
                  {item.platformDisputeReason
                    ? `: ${item.platformDisputeReason}`
                    : ""}
                  . Escrow frozen until ops review.
                </Text>
              ) : null}

              <View style={styles.actions}>
                {isSeller && item.status === "pending_accept" ? (
                  <Pressable
                    style={styles.primary}
                    onPress={() => void onAccept(item)}>
                    <Text style={styles.primaryText}>Accept order</Text>
                  </Pressable>
                ) : null}

                {isSeller && item.status === "accepted" ? (
                  <Pressable
                    style={styles.primary}
                    onPress={() =>
                      navigation.navigate("DropOff", { orderId: item.id })
                    }>
                    <Text style={styles.primaryText}>Drop off item</Text>
                  </Pressable>
                ) : null}

                {!isSeller && item.status === "ready_for_pickup" ? (
                  <Pressable
                    style={styles.primary}
                    onPress={() =>
                      navigation.navigate("Pickup", { orderId: item.id })
                    }>
                    <Text style={styles.primaryText}>Pick up item</Text>
                  </Pressable>
                ) : null}

                {(item.status === "pending_accept" ||
                  item.status === "accepted") && (
                  <Pressable
                    style={styles.secondary}
                    onPress={() => void onCancel(item)}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                )}

                {canDispute(item) ? (
                  <Pressable
                    style={styles.secondary}
                    onPress={() => onDispute(item)}>
                    <Text style={styles.secondaryText}>Open dispute</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabOn: {
    backgroundColor: "#111827",
  },
  tabText: {
    fontWeight: "600",
    color: "#111827",
  },
  tabTextOn: {
    color: "#fff",
  },
  subTabs: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  subTab: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  subTabOn: {
    backgroundColor: "#e8eefc",
    borderColor: "#2563eb",
  },
  subTabText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#5c6370",
    textAlign: "center",
  },
  subTabTextOn: {
    color: "#1d4ed8",
  },
  list: {
    padding: 16,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  emptyBody: {
    textAlign: "center",
    color: "#5c6370",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    marginTop: 4,
    color: "#5c6370",
    fontSize: 13,
  },
  disputeBanner: {
    marginTop: 10,
    backgroundColor: "#fff7ed",
    color: "#9a3412",
    fontSize: 13,
    lineHeight: 18,
    padding: 10,
    borderRadius: 8,
    overflow: "hidden",
  },
  linkBox: {
    marginTop: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
  },
  photoBox: {
    marginTop: 10,
  },
  dropOffPhoto: {
    width: "100%",
    height: 160,
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
  },
  linkLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5c6370",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  linkCode: {
    fontSize: 12,
    fontFamily: "Menlo",
    fontWeight: "600",
  },
  linkHint: {
    marginTop: 6,
    fontSize: 12,
    color: "#5c6370",
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  primary: {
    flexGrow: 1,
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondary: {
    flexGrow: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  secondaryText: {
    color: "#111827",
    fontWeight: "600",
  },
});
