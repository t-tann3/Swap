import { useCallback, useState } from "react";
import {
  ActivityIndicator,
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

type Filter = "attention" | "stuck" | "disputed" | "frozen" | "overdue";

export function AdminScreen() {
  const { profile } = useMarketplace();
  const isAdmin = profile?.roles.includes("admin") ?? false;
  const [filter, setFilter] = useState<Filter>("attention");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiRequest<{ data: Order[] }>(
      `/api/admin/orders/escrow?filter=${filter}`,
      { auth: true },
    );
    setOrders(res.data);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void load()
        .catch(err => {
          setError(err instanceof Error ? err.message : "Failed to load");
        })
        .finally(() => setLoading(false));
    }, [isAdmin, load]),
  );

  async function run(
    orderId: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setBusyId(orderId);
    setError(null);
    try {
      await apiRequest(path, {
        method: "POST",
        auth: true,
        body: JSON.stringify(body ?? {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Admin role required.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const filters: Filter[] = [
    "attention",
    "disputed",
    "stuck",
    "frozen",
    "overdue",
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Admin</Text>
      <Text style={styles.help}>
        Resolve disputes and approve escrow actions. Separate from buyer/seller.
      </Text>

      <View style={styles.filters}>
        {filters.map(f => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipOn]}
            onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {orders.length === 0 ? (
        <Text style={styles.meta}>No orders in this queue.</Text>
      ) : (
        orders.map(order => (
          <View key={order.id} style={styles.card}>
            <Text style={styles.title}>
              {order.listing?.title ?? order.listingId}
            </Text>
            <Text style={styles.meta}>
              {order.status} · {order.paymentStatus ?? "—"}
            </Text>
            <Text style={styles.meta}>
              Dispute: {order.disputeStatus ?? "—"} · Hold:{" "}
              {order.adminHold ? "yes" : "no"}
            </Text>
            {order.transferLastError ? (
              <Text style={styles.error}>{order.transferLastError}</Text>
            ) : null}

            <View style={styles.actions}>
              {(order.paymentStatus === "disputed" || order.stripeDisputeId) && (
                <>
                  <Action
                    label="Dispute → refund"
                    disabled={busyId === order.id}
                    onPress={() =>
                      void run(
                        order.id,
                        `/api/admin/orders/${order.id}/dispute/resolve`,
                        { action: "refund" },
                      )
                    }
                  />
                  <Action
                    label="Dispute → release"
                    disabled={busyId === order.id}
                    onPress={() =>
                      void run(
                        order.id,
                        `/api/admin/orders/${order.id}/dispute/resolve`,
                        { action: "release" },
                      )
                    }
                  />
                </>
              )}
              <Action
                label="Force refund"
                disabled={busyId === order.id}
                onPress={() =>
                  void run(order.id, `/api/admin/orders/${order.id}/force-refund`)
                }
              />
              <Action
                label="Force release"
                disabled={busyId === order.id}
                onPress={() =>
                  void run(
                    order.id,
                    `/api/admin/orders/${order.id}/force-release`,
                    { overrideDispute: false },
                  )
                }
              />
              <Action
                label="Retry transfer"
                disabled={busyId === order.id}
                onPress={() =>
                  void run(
                    order.id,
                    `/api/admin/orders/${order.id}/retry-transfer`,
                  )
                }
              />
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f4f5f7",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f5f7",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  help: {
    fontSize: 14,
    color: "#5c6370",
    marginBottom: 16,
    lineHeight: 20,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  chipOn: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
    textTransform: "capitalize",
  },
  chipTextOn: {
    color: "#fff",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    color: "#5c6370",
  },
  error: {
    color: "#b42318",
    marginTop: 8,
    marginBottom: 8,
  },
  actions: {
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  disabled: {
    opacity: 0.5,
  },
});
