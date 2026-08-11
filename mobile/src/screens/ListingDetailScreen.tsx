import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";
import { mediaUrl } from "../media/photos";

type Props = {
  route: { params: { id: string } };
  navigation: {
    goBack: () => void;
    navigate: (screen: "Checkout", params: { listingId: string }) => void;
  };
};

export function ListingDetailScreen({ route, navigation }: Props) {
  const {
    profile,
    toggleFavorite,
    isFavorite,
    updateListing,
    deleteListing,
    showPrices,
    pantryMode,
  } = useMarketplace();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editStock, setEditStock] = useState("1");
  const [editMax, setEditMax] = useState("1");
  const [savingCaps, setSavingCaps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<Listing>(
          `/api/listings/${route.params.id}`,
        );
        if (!cancelled) {
          setListing(data);
          setEditStock(String(data.stockQty ?? 1));
          setEditMax(String(data.maxPerOrder ?? 1));
        }
      } catch {
        if (!cancelled) setListing(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.params.id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Listing not found.</Text>
      </View>
    );
  }

  const isSeller = profile?.userId === listing.sellerUserId;
  const canBuy =
    !!profile?.roles.includes("buyer") &&
    listing.status === "available" &&
    !isSeller;
  const liked = isFavorite(listing.id);

  function onBuy() {
    if (!canBuy || !listing) return;
    navigation.navigate("Checkout", { listingId: listing.id });
  }

  async function onAddToBasket() {
    if (!listing) return;
    setAdding(true);
    try {
      await apiRequest("/api/me/basket/items", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ listingId: listing.id, quantity: 1 }),
      });
      Alert.alert("Basket", "Added to basket.");
    } catch (err) {
      Alert.alert(
        "Basket",
        err instanceof Error ? err.message : "Could not add",
      );
    } finally {
      setAdding(false);
    }
  }

  async function onSaveCaps() {
    if (!listing) return;
    const stock = Number.parseInt(editStock, 10);
    const max = Number.parseInt(editMax, 10);
    if (!Number.isFinite(stock) || stock < 1 || !Number.isFinite(max) || max < 1) {
      Alert.alert("Caps", "Stock and max per patron must be at least 1.");
      return;
    }
    setSavingCaps(true);
    try {
      const next = await updateListing(listing.id, {
        stockQty: stock,
        maxPerOrder: max,
      });
      setListing(next);
      Alert.alert("Saved", "Stock and per-item cap updated.");
    } catch (err) {
      Alert.alert(
        "Could not save",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSavingCaps(false);
    }
  }

  async function onDelete() {
    if (!listing) return;
    const listingId = listing.id;
    Alert.alert("Delete listing?", "This will remove it from the marketplace.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteListing(listingId);
              navigation.goBack();
            } catch (err) {
              Alert.alert(
                "Could not delete",
                err instanceof Error ? err.message : "Unknown error",
              );
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {mediaUrl(listing.imageUrl) ? (
        <Image
          source={{ uri: mediaUrl(listing.imageUrl)! }}
          style={styles.hero}
        />
      ) : (
        <View style={[styles.hero, { backgroundColor: listing.imageColor }]} />
      )}
      <Text style={styles.title}>{listing.title}</Text>
      {showPrices ? (
        <Text style={styles.price}>
          ${(listing.priceCents / 100).toFixed(2)}
        </Text>
      ) : null}
      {pantryMode ? (
        <Text style={styles.meta}>
          {(listing.stockQty ?? 0) <= 0 || listing.status === "out_of_stock"
            ? "Out of stock"
            : `${listing.stockQty} in stock${
                listing.maxPerOrder != null
                  ? ` · max ${listing.maxPerOrder} per patron`
                  : ""
              }`}
        </Text>
      ) : null}
      <View style={styles.tagRow}>
        <Text style={styles.categoryTag}>{listing.category}</Text>
        <Text style={styles.meta}>
          {listing.condition.replace("_", " ")} ·{" "}
          {listing.status.replace(/_/g, " ")}
        </Text>
      </View>
      <Text style={styles.body}>{listing.description}</Text>
      <Text style={styles.meta}>
        Must fit a Relai Exchange Zone compartment. All doors are the same size.
      </Text>
      <Text style={styles.meta}>Pickup area: {listing.locationLabel}</Text>
      <Text style={styles.meta}>
        Seller: {listing.sellerName ?? listing.sellerEmail ?? "Seller"}
      </Text>

      {isSeller && pantryMode ? (
        <View style={styles.capsBox}>
          <Text style={styles.capsTitle}>Stock & per-item cap</Text>
          <Text style={styles.meta}>
            Max per patron limits how many of this item one basket may hold.
          </Text>
          <Text style={styles.fieldLabel}>Stock</Text>
          <TextInput
            style={styles.input}
            value={editStock}
            onChangeText={setEditStock}
            keyboardType="number-pad"
          />
          <Text style={styles.fieldLabel}>Max per patron</Text>
          <TextInput
            style={styles.input}
            value={editMax}
            onChangeText={setEditMax}
            keyboardType="number-pad"
          />
          <Pressable
            style={[styles.button, savingCaps && styles.disabled]}
            disabled={savingCaps}
            onPress={() => void onSaveCaps()}>
            <Text style={styles.buttonText}>
              {savingCaps ? "Saving…" : "Save caps"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={styles.secondary}
        onPress={() => void toggleFavorite(listing.id)}>
        <Text style={styles.secondaryText}>
          {liked ? "Remove favorite" : "Save to favorites"}
        </Text>
      </Pressable>

      {canBuy && pantryMode ? (
        <Pressable
          style={[styles.button, adding && styles.disabled]}
          disabled={adding}
          onPress={() => void onAddToBasket()}>
          <Text style={styles.buttonText}>
            {adding ? "Adding…" : "Add to basket"}
          </Text>
        </Pressable>
      ) : null}
      {canBuy && !pantryMode ? (
        <Pressable style={styles.button} onPress={onBuy}>
          <Text style={styles.buttonText}>Buy</Text>
        </Pressable>
      ) : null}

      {isSeller ? (
        <Pressable style={styles.danger} onPress={onDelete}>
          <Text style={styles.buttonText}>Delete listing</Text>
        </Pressable>
      ) : null}
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
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f5f7",
  },
  hero: {
    height: 160,
    borderRadius: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  price: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  categoryTag: {
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  meta: {
    fontSize: 13,
    color: "#5c6370",
    textTransform: "capitalize",
  },
  capsBox: {
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  capsTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  body: {
    fontSize: 16,
    color: "#414651",
    lineHeight: 24,
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  secondary: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  secondaryText: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "600",
  },
  danger: {
    backgroundColor: "#b42318",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
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
