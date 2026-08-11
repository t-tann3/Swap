import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ListingCard({
  item,
  onPress,
  rightLabel,
}: {
  item: Listing;
  onPress: () => void;
  rightLabel?: string;
}) {
  const { showPrices } = useMarketplace();

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.swatch, { backgroundColor: item.imageColor }]} />
      <View style={styles.body}>
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {showPrices ? (
            <Text style={styles.price}>{formatPrice(item.priceCents)}</Text>
          ) : null}
        </View>
        <View style={styles.tagRow}>
          <Text style={styles.categoryTag}>{item.category}</Text>
          <Text style={styles.sizeTag}>
            {item.compartmentSize === "S"
              ? "Small · backpack"
              : item.compartmentSize === "M"
                ? "Medium · 1 carry-on"
                : item.compartmentSize === "L"
                  ? "Large · 2 carry-ons"
                  : "Size ?"}
          </Text>
          <Text style={styles.meta}>
            {item.condition.replace("_", " ")}
            {rightLabel ? ` · ${rightLabel}` : ""}
          </Text>
        </View>
        <Text style={styles.desc} numberOfLines={2}>
          {item.description}
        </Text>
        <Text style={styles.location}>{item.locationLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    gap: 12,
  },
  swatch: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  body: {
    flex: 1,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 2,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  price: {
    fontSize: 16,
    fontWeight: "700",
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  categoryTag: {
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  sizeTag: {
    backgroundColor: "#f3f4f6",
    color: "#374151",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  meta: {
    fontSize: 12,
    color: "#5c6370",
    textTransform: "capitalize",
  },
  desc: {
    fontSize: 14,
    color: "#414651",
    lineHeight: 19,
  },
  location: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
  },
});
