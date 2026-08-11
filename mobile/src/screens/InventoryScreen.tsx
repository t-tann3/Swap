import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";
import { mediaUrl } from "../media/photos";
import type { SellStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<SellStackParamList, "Inventory">;

type InventoryRow = {
  listing: Listing;
  available: number;
  reserved: number;
  total: number;
  lowStock: boolean;
  outOfStock: boolean;
};

export function InventoryScreen({ navigation }: Props) {
  const { profile, pantryMode } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiRequest<{
      lowStockThreshold: number;
      data: InventoryRow[];
    }>("/api/me/inventory", { auth: true });
    setThreshold(res.lowStockThreshold);
    setRows(res.data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isSeller || !pantryMode) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      void load()
        .catch(err => {
          setError(
            err instanceof Error ? err.message : "Failed to load inventory",
          );
        })
        .finally(() => setLoading(false));
    }, [isSeller, pantryMode, load]),
  );

  async function adjust(listingId: string, delta: number) {
    setBusyId(listingId);
    setError(null);
    try {
      await apiRequest(`/api/listings/${listingId}/stock-adjust`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ delta }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not adjust stock");
    } finally {
      setBusyId(null);
    }
  }

  if (!isSeller) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Seller role required</Text>
      </View>
    );
  }

  if (!pantryMode) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Inventory</Text>
        <Text style={styles.meta}>
          Inventory lite is available when pantry mode is on.
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

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={row => row.listing.id}
        contentContainerStyle={
          rows.length === 0 ? styles.emptyList : styles.list
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>Inventory</Text>
            <Text style={styles.help}>
              Available is free stock. Reserved is held in patron baskets.
              Low-stock flag at ≤ {threshold}.
            </Text>
            <Pressable
              style={styles.secondary}
              onPress={() => navigation.navigate("SellHome")}>
              <Text style={styles.secondaryText}>Post item</Text>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.meta}>
            No pantry listings yet. Post food from Sell.
          </Text>
        }
        renderItem={({ item: row }) => {
          const photo = mediaUrl(row.listing.imageUrl);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.thumb} />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      { backgroundColor: row.listing.imageColor },
                    ]}
                  />
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.title}>{row.listing.title}</Text>
                  <Text style={styles.meta}>
                    {row.outOfStock
                      ? "Out of stock"
                      : row.lowStock
                        ? "Low stock"
                        : "In stock"}{" "}
                    · max/order {row.listing.maxPerOrder ?? 1}
                  </Text>
                </View>
              </View>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Available</Text>
                  <Text style={styles.statValue}>{row.available}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Reserved</Text>
                  <Text style={styles.statValue}>{row.reserved}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Total</Text>
                  <Text style={styles.statValue}>{row.total}</Text>
                </View>
              </View>
              {(row.lowStock || row.outOfStock) && (
                <Text
                  style={[
                    styles.flag,
                    row.outOfStock ? styles.flagOut : styles.flagLow,
                  ]}>
                  {row.outOfStock ? "Out of stock" : "Low stock"}
                </Text>
              )}
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.adjustBtn,
                    busyId === row.listing.id && styles.disabled,
                  ]}
                  disabled={busyId === row.listing.id}
                  onPress={() => void adjust(row.listing.id, -1)}>
                  <Text style={styles.adjustText}>−1</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.adjustBtn,
                    styles.adjustPlus,
                    busyId === row.listing.id && styles.disabled,
                  ]}
                  disabled={busyId === row.listing.id}
                  onPress={() => void adjust(row.listing.id, 1)}>
                  <Text style={[styles.adjustText, styles.adjustPlusText]}>
                    +1
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
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
  list: { padding: 16, paddingBottom: 40 },
  emptyList: { flexGrow: 1, padding: 16 },
  header: { marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  help: {
    fontSize: 13,
    color: "#5c6370",
    lineHeight: 18,
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  secondary: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 8,
  },
  secondaryText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#e5e7eb",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { marginTop: 4, color: "#5c6370", fontSize: 13 },
  stats: { flexDirection: "row", gap: 20, marginTop: 12 },
  stat: {},
  statLabel: { fontSize: 11, color: "#5c6370" },
  statValue: { fontSize: 18, fontWeight: "700", marginTop: 2 },
  flag: {
    marginTop: 10,
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  flagLow: { backgroundColor: "#fff7ed", color: "#9a3412" },
  flagOut: { backgroundColor: "#fef2f2", color: "#b42318" },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  adjustBtn: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  adjustPlus: { backgroundColor: "#111827", borderColor: "#111827" },
  adjustText: { fontSize: 15, fontWeight: "700", color: "#111827" },
  adjustPlusText: { color: "#fff" },
  error: { color: "#b42318", marginTop: 8, fontSize: 13 },
  disabled: { opacity: 0.5 },
});
