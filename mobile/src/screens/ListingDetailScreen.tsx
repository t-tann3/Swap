import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { apiRequest } from "../api/client";
import { formatCompartmentSize } from "../marketplace/compartmentSizes";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";

type Props = {
  route: { params: { id: string } };
  navigation: {
    goBack: () => void;
    navigate: (screen: "Checkout", params: { listingId: string }) => void;
  };
};

export function ListingDetailScreen({ route, navigation }: Props) {
  const { profile, toggleFavorite, isFavorite, deleteListing, showPrices } =
    useMarketplace();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<Listing>(
          `/api/listings/${route.params.id}`,
        );
        if (!cancelled) setListing(data);
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
      <View style={[styles.hero, { backgroundColor: listing.imageColor }]} />
      <Text style={styles.title}>{listing.title}</Text>
      {showPrices ? (
        <Text style={styles.price}>
          ${(listing.priceCents / 100).toFixed(2)}
        </Text>
      ) : null}
      <View style={styles.tagRow}>
        <Text style={styles.categoryTag}>{listing.category}</Text>
        <Text style={styles.sizeTag}>
          {formatCompartmentSize(listing.compartmentSize)}
        </Text>
        <Text style={styles.meta}>
          {listing.condition.replace("_", " ")} · {listing.status}
        </Text>
      </View>
      <Text style={styles.body}>{listing.description}</Text>
      <Text style={styles.meta}>
        Must fit a Relai Exchange Zone {listing.compartmentSize} compartment.
      </Text>
      <Text style={styles.meta}>Pickup area: {listing.locationLabel}</Text>
      <Text style={styles.meta}>
        Seller: {listing.sellerName ?? listing.sellerEmail ?? "Seller"}
      </Text>

      <Pressable
        style={styles.secondary}
        onPress={() => void toggleFavorite(listing.id)}>
        <Text style={styles.secondaryText}>
          {liked ? "Remove favorite" : "Save to favorites"}
        </Text>
      </Pressable>

      {canBuy ? (
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
  sizeTag: {
    backgroundColor: "#f3f4f6",
    color: "#374151",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  meta: {
    fontSize: 13,
    color: "#5c6370",
    textTransform: "capitalize",
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
