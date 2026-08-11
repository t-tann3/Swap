import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";
import { getRelai } from "../relai/client";

type BasketItem = {
  listingId: string;
  quantity: number;
  listing: Listing | null;
  maxPerOrder?: number;
  basketLimit?: number;
};

export function BasketScreen() {
  const { pantryMode, refresh } = useMarketplace();
  const [items, setItems] = useState<BasketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiRequest<{
      basket: { items: BasketItem[] };
    }>("/api/me/basket", { auth: true });
    setItems(res.basket.items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!pantryMode) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void load()
        .catch(err => {
          Alert.alert(
            "Basket",
            err instanceof Error ? err.message : "Failed to load",
          );
        })
        .finally(() => setLoading(false));
    }, [pantryMode, load]),
  );

  if (!pantryMode) {
    return (
      <View style={styles.center}>
        <Text style={styles.meta}>
          Pantry mode is off. Ask an admin to enable baskets and item caps.
        </Text>
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

  async function setQty(listingId: string, quantity: number) {
    try {
      const res = await apiRequest<{
        basket: { items: BasketItem[] };
      }>(`/api/me/basket/items/${listingId}`, {
        method: "PATCH",
        auth: true,
        body: JSON.stringify({ quantity }),
      });
      setItems(res.basket.items);
    } catch (err) {
      Alert.alert(
        "Basket",
        err instanceof Error ? err.message : "Could not update",
      );
    }
  }

  async function checkout() {
    setBusy(true);
    try {
      const zones = await getRelai().exchangeZones.list({ limit: 50 });
      const zone =
        zones.find(z => z.is_open_now && z.nodes_available > 0) ?? zones[0];
      if (!zone) {
        Alert.alert("Checkout", "No Exchange Zone available.");
        return;
      }
      await apiRequest("/api/me/basket/checkout", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          exchangeZoneId: zone.id,
          exchangeZoneName: zone.name,
          exchangeZoneAddress: zone.address ?? null,
        }),
      });
      await refresh();
      await load();
      Alert.alert(
        "Placed",
        "Reserved. Your order is under Placed — waiting for the pantry to accept.",
      );
    } catch (err) {
      Alert.alert(
        "Checkout",
        err instanceof Error ? err.message : "Checkout failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={i => i.listingId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.meta}>Basket empty — browse food to add items.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>
              {item.listing?.title ?? item.listingId}
            </Text>
            <Text style={styles.meta}>
              Qty {item.quantity}
              {item.maxPerOrder != null
                ? ` · max ${item.maxPerOrder} of this item`
                : ""}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => void setQty(item.listingId, item.quantity - 1)}>
                <Text style={styles.qtyText}>−</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.qtyBtn,
                  item.quantity >=
                    (item.basketLimit ?? item.maxPerOrder ?? Infinity) &&
                    styles.disabled,
                ]}
                disabled={
                  item.quantity >=
                  (item.basketLimit ?? item.maxPerOrder ?? Infinity)
                }
                onPress={() => void setQty(item.listingId, item.quantity + 1)}>
                <Text style={styles.qtyText}>+</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
      {items.length > 0 ? (
        <Pressable
          style={[styles.checkout, busy && styles.disabled]}
          disabled={busy}
          onPress={() => void checkout()}>
          <Text style={styles.checkoutText}>
            {busy ? "Reserving…" : "Reserve for pickup (free)"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f5f7" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f4f5f7",
  },
  list: { padding: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { marginTop: 4, color: "#5c6370", fontSize: 13 },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  qtyBtn: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  qtyText: { fontSize: 18, fontWeight: "700" },
  checkout: {
    margin: 16,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  checkoutText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
});
