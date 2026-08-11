import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Image,
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
import { useMarketplace } from "../marketplace/MarketplaceContext";
import { mediaUrl, pickAndUploadPhoto } from "../media/photos";
import type { SellStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<SellStackParamList, "SellHome">;

export function SellScreen({ navigation }: Props) {
  const { profile, myListings, createListing, showPrices } = useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ListingCategory>("General");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

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

  async function onPickPhoto(source: "camera" | "library") {
    setPhotoBusy(true);
    try {
      const url = await pickAndUploadPhoto(source);
      if (url) setImageUrl(url);
    } catch (err) {
      Alert.alert(
        "Photo failed",
        err instanceof Error ? err.message : "Could not upload photo",
      );
    } finally {
      setPhotoBusy(false);
    }
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
        priceCents: Math.round(dollars * 100),
        condition: "good",
        locationLabel: "Local Exchange Zone",
        imageUrl,
      });
      setTitle("");
      setDescription("");
      setPrice("");
      setCategory("General");
      setImageUrl(null);
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

  const previewUri = mediaUrl(imageUrl);

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
            Items must fit a Relai Exchange Zone compartment. All doors are the
            same size. A listing photo is optional.
          </Text>
          <Text style={styles.label}>Photo (optional)</Text>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.preview} />
          ) : (
            <View style={styles.previewEmpty}>
              <Text style={styles.previewEmptyText}>No photo yet</Text>
            </View>
          )}
          <View style={styles.photoRow}>
            <Pressable
              style={[styles.secondary, photoBusy && styles.buttonDisabled]}
              disabled={photoBusy || busy}
              onPress={() => void onPickPhoto("camera")}>
              <Text style={styles.secondaryText}>Take photo</Text>
            </Pressable>
            <Pressable
              style={[styles.secondary, photoBusy && styles.buttonDisabled]}
              disabled={photoBusy || busy}
              onPress={() => void onPickPhoto("library")}>
              <Text style={styles.secondaryText}>Choose</Text>
            </Pressable>
            {imageUrl ? (
              <Pressable
                style={styles.secondary}
                disabled={busy}
                onPress={() => setImageUrl(null)}>
                <Text style={styles.secondaryText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
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
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={onPost}
            disabled={busy || photoBusy}>
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
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111827",
  },
  preview: {
    width: "100%",
    height: 180,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#e5e7eb",
  },
  previewEmpty: {
    width: "100%",
    height: 120,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  previewEmptyText: {
    color: "#6b7280",
    fontSize: 14,
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  secondary: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: "600",
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
