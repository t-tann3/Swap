import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Order } from "../marketplace/types";
import type { OrdersStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<OrdersStackParamList, "OrdersHome">;

type StatusBucket =
  | "placed"
  | "accepted"
  | "ready_for_pickup"
  | "completed";

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

function isDropOffOverdue(order: Order): boolean {
  if (order.status !== "accepted" || !order.sellerDropOffDeadlineAt) return false;
  return Date.parse(order.sellerDropOffDeadlineAt) < Date.now();
}

function statusLabel(order: Order): string | null {
  const pantryOrder = order.priceCents === 0;
  switch (order.status) {
    case "pending_accept":
      return pantryOrder ? "Placed — waiting for pantry" : "Waiting for seller";
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
          : "Completed — buyer no-show (paid to seller)";
      }
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

function orderTitle(order: Order): string {
  const email = order.buyerEmail?.trim() || "Unknown";
  return `${email}'s Order Basket`;
}

export function OrdersScreen({ navigation }: Props) {
  const {
    ordersAsBuyer,
    ordersAsSeller,
    profile,
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

  return (
    <View style={styles.container}>
      {showRoleTabs ? (
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, roleTab === "buying" && styles.tabOn]}
            onPress={() => {
              setTab("buying");
            }}>
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
            onPress={() => {
              setTab("selling");
            }}>
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
          const isSeller = roleTab === "selling";
          const label = statusLabel(item);
          return (
            <Pressable
              style={styles.card}
              onPress={() =>
                navigation.navigate("OrderDetail", { orderId: item.id })
              }>
              <View style={styles.cardHeader}>
                <Text style={styles.title} numberOfLines={2}>
                  {orderTitle(item)}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </View>
              <Text style={styles.orderId} numberOfLines={1}>
                Order ID: {item.id}
              </Text>
              {showPrices || label || (isSeller && isDropOffOverdue(item)) ? (
                <Text style={styles.meta}>
                  {showPrices
                    ? `$${(item.priceCents / 100).toFixed(2)}${
                        label ? " · " : ""
                      }`
                    : ""}
                  {label ?? ""}
                  {isSeller && isDropOffOverdue(item) ? (
                    <Text style={styles.overdue}> Overdue</Text>
                  ) : null}
                </Text>
              ) : null}
              {item.exchangeZoneName ? (
                <Text style={styles.meta} numberOfLines={2}>
                  Exchange Zone: {item.exchangeZoneName}
                  {item.exchangeZoneAddress
                    ? ` · ${item.exchangeZoneAddress}`
                    : ""}
                </Text>
              ) : null}
            </Pressable>
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
    color: "#9ca3af",
    fontWeight: "300",
  },
  orderId: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#4b5563",
  },
  meta: {
    marginTop: 4,
    color: "#5c6370",
    fontSize: 13,
  },
  overdue: {
    color: "#9a3412",
    fontWeight: "700",
  },
});
