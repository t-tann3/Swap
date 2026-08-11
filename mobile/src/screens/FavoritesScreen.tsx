import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { ListingCard } from "../components/ListingCard";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { FavoritesStackParamList } from "../navigation/types";

export function FavoritesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<FavoritesStackParamList, "FavoritesHome">;
}) {
  const { favorites } = useMarketplace();

  return (
    <View style={styles.container}>
      <FlatList
        data={favorites}
        keyExtractor={item => item.id}
        contentContainerStyle={
          favorites.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={
          <Text style={styles.emptyBody}>
            Saved items show up here. Open a listing and tap Save to favorites.
          </Text>
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
  list: {
    padding: 16,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  emptyBody: {
    fontSize: 15,
    color: "#5c6370",
    lineHeight: 21,
    textAlign: "center",
  },
});
