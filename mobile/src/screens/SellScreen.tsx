import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ListingCard } from "../components/ListingCard";
import {
  LISTING_CATEGORIES,
  type ListingCategory,
} from "../marketplace/categories";
import {
  COMPARTMENT_SIZES,
  type CompartmentSizeId,
} from "../marketplace/compartmentSizes";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { SellStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<SellStackParamList, "SellHome">;

export function SellScreen({ navigation }: Props) {
  const { profile, myListings, createListing, showPrices } = useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ListingCategory>("General");
  const [compartmentSize, setCompartmentSize] =
    useState<CompartmentSizeId>("M");
  const [busy, setBusy] = useState(false);

  if (!profile?.roles.includes("seller")) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Seller role required</Text>
        <Text style={styles.emptyBody}>
          Enable Seller in Account to post items.
        </Text>
      </View>
    );
  }

  async function onPost() {
    const dollars = showPrices ? Number.parseFloat(price) : 0;
    if (
      !title.trim() ||
      !description.trim() ||
      !category ||
      (showPrices && (Number.isNaN(dollars) || dollars < 0))
    ) {
      Alert.alert(
        "Missing info",
        showPrices
          ? "Add a title, description, category, and valid price."
          : "Add a title, description, and category.",
      );
      return;
    }
    setBusy(true);
    try {
      await createListing({
        title,
        description,
        category,
        compartmentSize,
        priceCents: Math.round(dollars * 100),
        condition: "good",
        locationLabel: "Local Exchange Zone",
      });
      setTitle("");
      setDescription("");
      setPrice("");
      setCategory("General");
      setCompartmentSize("M");
      Alert.alert("Posted", "Your listing is live for buyers.");
    } catch (err) {
      Alert.alert(
        "Could not post",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={myListings}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <View style={styles.form}>
          <Text style={styles.heading}>Post an item</Text>
          <Text style={styles.help}>
            Items must fit a Relai Exchange Zone Full Tower door (max about
            24″×16″×21″). Pick the smallest compartment that fits.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Description"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {showPrices ? (
            <TextInput
              style={styles.input}
              placeholder="Price (USD)"
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
            />
          ) : null}
          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryRow}>
            {LISTING_CATEGORIES.map(cat => {
              const active = category === cat;
              return (
                <Pressable
                  key={cat}
                  style={[styles.catChip, active && styles.catChipOn]}
                  onPress={() => setCategory(cat)}>
                  <Text
                    style={[styles.catChipText, active && styles.catChipTextOn]}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Compartment size</Text>
          {COMPARTMENT_SIZES.map(size => {
            const active = compartmentSize === size.id;
            return (
              <Pressable
                key={size.id}
                style={[styles.sizeCard, active && styles.sizeCardOn]}
                onPress={() => setCompartmentSize(size.id)}>
                <Text style={styles.sizeTitle}>
                  {size.label} · ≤ {size.maxHeightIn}×{size.maxWidthIn}×
                  {size.maxDepthIn}&quot;
                </Text>
                <Text style={styles.sizeDesc}>{size.description}</Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={onPost}
            disabled={busy}>
            <Text style={styles.buttonText}>Post listing</Text>
          </Pressable>
          <Text style={styles.heading}>Your listings</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyBody}>No listings yet.</Text>
      }
      renderItem={({ item }) => (
        <ListingCard
          item={item}
          rightLabel={item.status}
          onPress={() =>
            navigation.navigate("ListingDetail", { id: item.id })
          }
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
  },
  content: {
    padding: 16,
  },
  form: {
    marginBottom: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 8,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  help: {
    fontSize: 13,
    color: "#5c6370",
    lineHeight: 18,
    marginBottom: 12,
  },
  sizeCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#f3f4f6",
    padding: 12,
    marginBottom: 8,
  },
  sizeCardOn: {
    borderColor: "#111827",
  },
  sizeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  sizeDesc: {
    marginTop: 4,
    fontSize: 12,
    color: "#5c6370",
    lineHeight: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111827",
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  catChip: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  catChipOn: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  catChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  catChipTextOn: {
    color: "#fff",
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f4f5f7",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 15,
    color: "#5c6370",
    lineHeight: 21,
  },
});
