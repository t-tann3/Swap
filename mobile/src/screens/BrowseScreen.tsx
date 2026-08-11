import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ListingCard } from "../components/ListingCard";
import { LISTING_CATEGORIES } from "../marketplace/categories";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { BuyerStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<BuyerStackParamList, "Browse">;

export function BrowseScreen({ navigation }: Props) {
  const {
    availableListings,
    profile,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    refresh,
    refreshing,
  } = useMarketplace();

  const filterCategories = ["", ...LISTING_CATEGORIES];

  if (!profile?.roles.includes("buyer")) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Buyer role required</Text>
        <Text style={styles.emptyBody}>
          Enable Buyer in Account to browse and buy items.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search marketplace"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      <FlatList
        horizontal
        data={filterCategories}
        keyExtractor={(item, index) => (item ? `cat-${item}` : `all-${index}`)}
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsContent}
        renderItem={({ item }) => {
          const label = item || "All";
          const active = selectedCategory === item;
          return (
            <Pressable
              style={[styles.chip, active && styles.chipOn]}
              onPress={() => setSelectedCategory(item)}>
              <Text style={[styles.chipText, active && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        }}
      />
      <FlatList
        data={availableListings}
        keyExtractor={item => item.id}
        contentContainerStyle={
          availableListings.length === 0 ? styles.emptyList : styles.list
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        ListEmptyComponent={
          refreshing ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.emptyBody}>
              No items match. Try another search or category.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <ListingCard
            item={item}
            onPress={() =>
              navigation.navigate("ListingDetail", { id: item.id })
            }
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  search: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  chips: {
    flexGrow: 0,
    marginTop: 12,
    marginBottom: 4,
  },
  chipsContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    alignItems: "center",
  },
  chip: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    minHeight: 40,
    justifyContent: "center",
  },
  chipOn: {
    backgroundColor: "#111827",
  },
  chipText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 18,
  },
  chipTextOn: {
    color: "#fff",
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
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
    textAlign: "center",
  },
});
