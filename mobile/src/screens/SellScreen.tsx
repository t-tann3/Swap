import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
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

export function SellScreen({ navigation, route }: Props) {
  const { profile, myListings, createListing, showPrices, pantryMode } =
    useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQty, setStockQty] = useState("1");
  const [maxPerOrder, setMaxPerOrder] = useState("1");
  const [category, setCategory] = useState<ListingCategory>("General");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  useEffect(() => {
    const draft = route.params?.draft;
    if (!draft) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setCategory(draft.category);
    setImageUrl(draft.imageUrl);
    setScanNote(
      draft.barcode
        ? `Filled from barcode ${draft.barcode}. Adjust stock, then post.`
        : "Filled from catalog. Adjust stock, then post.",
    );
    navigation.setParams({ draft: undefined });
  }, [route.params?.draft, navigation]);

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
    const stock = pantryMode ? Number.parseInt(stockQty, 10) : 1;
    const itemCap = pantryMode ? Number.parseInt(maxPerOrder, 10) : 1;
    if (
      !title.trim() ||
      !description.trim() ||
      !category ||
      (showPrices && (Number.isNaN(dollars) || dollars < 0)) ||
      (pantryMode &&
        (!Number.isFinite(stock) ||
          stock < 1 ||
          !Number.isFinite(itemCap) ||
          itemCap < 1))
    ) {
      Alert.alert(
        "Missing info",
        showPrices
          ? "Add a title, description, category, and valid price."
          : pantryMode
            ? "Add title, description, stock, and per-item basket cap."
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
        stockQty: pantryMode ? stock : 1,
        maxPerOrder: pantryMode ? itemCap : 1,
      });
      setTitle("");
      setDescription("");
      setPrice("");
      setStockQty("1");
      setMaxPerOrder("1");
      setCategory("General");
      setImageUrl(null);
      setScanNote(null);
      Alert.alert(
        "Posted",
        pantryMode ? "Food listed for pantry." : "Your listing is live for buyers.",
      );
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
          <Text style={styles.heading}>
            {pantryMode ? "Stock pantry food" : "Post an item"}
          </Text>
          <Text style={styles.help}>
            {pantryMode
              ? "Scan a barcode to fill title and catalog photo, then set stock."
              : "Items must fit a Relai Exchange Zone compartment. All doors are the same size. A listing photo is optional."}
          </Text>
          {pantryMode ? (
            <View style={styles.actionRow}>
              <Pressable
                style={styles.inventoryBtn}
                onPress={() => navigation.navigate("BarcodeScan")}>
                <Text style={styles.secondaryText}>Scan barcode</Text>
              </Pressable>
              <Pressable
                style={styles.inventoryBtn}
                onPress={() => navigation.navigate("Inventory")}>
                <Text style={styles.secondaryText}>Inventory</Text>
              </Pressable>
            </View>
          ) : null}
          {scanNote ? <Text style={styles.scanNote}>{scanNote}</Text> : null}
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
          {pantryMode ? (
            <>
              <Text style={styles.label}>Stock on shelf</Text>
              <TextInput
                style={styles.input}
                value={stockQty}
                onChangeText={setStockQty}
                keyboardType="number-pad"
              />
              <Text style={styles.hint}>How many units you have available.</Text>
              <Text style={styles.label}>Max per patron (this item)</Text>
              <TextInput
                style={styles.input}
                value={maxPerOrder}
                onChangeText={setMaxPerOrder}
                keyboardType="number-pad"
              />
              <Text style={styles.hint}>
                Cap for this food in one basket (not the Admin total-unit
                patron cap).
              </Text>
            </>
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
          rightLabel={item.status.replace(/_/g, " ")}
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
  hint: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 10,
    marginTop: -4,
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
  inventoryBtn: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  scanNote: {
    fontSize: 13,
    color: "#047857",
    marginBottom: 12,
    lineHeight: 18,
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
