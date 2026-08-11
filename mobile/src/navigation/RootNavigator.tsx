import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  Heart,
  Home,
  Package,
  Shield,
  Store,
  UserRound,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthContext";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import { AccountScreen } from "../screens/AccountScreen";
import { AdminScreen } from "../screens/AdminScreen";
import { BrowseScreen } from "../screens/BrowseScreen";
import { CheckoutScreen } from "../screens/CheckoutScreen";
import { FavoritesScreen } from "../screens/FavoritesScreen";
import { ListingDetailScreen } from "../screens/ListingDetailScreen";
import { DropOffScreen } from "../screens/DropOffScreen";
import { OrdersScreen } from "../screens/OrdersScreen";
import { PickupScreen } from "../screens/PickupScreen";
import { RoleSetupScreen } from "../screens/RoleSetupScreen";
import { SellScreen } from "../screens/SellScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { VerifyCodeScreen } from "../screens/VerifyCodeScreen";
import type {
  BuyerStackParamList,
  FavoritesStackParamList,
  OrdersStackParamList,
  RootTabParamList,
  SellStackParamList,
} from "./types";

const Tab = createBottomTabNavigator<RootTabParamList>();
const BrowseStack = createNativeStackNavigator<BuyerStackParamList>();
const FavoritesStack = createNativeStackNavigator<FavoritesStackParamList>();
const SellStack = createNativeStackNavigator<SellStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();

const ACTIVE = "#2563eb";
const INACTIVE = "#6b7280";

function BrowseStackNavigator() {
  return (
    <BrowseStack.Navigator>
      <BrowseStack.Screen
        name="Browse"
        component={BrowseScreen}
        options={{ title: "Browse" }}
      />
      <BrowseStack.Screen
        name="ListingDetail"
        component={ListingDetailScreen}
        options={{ title: "Item" }}
      />
      <BrowseStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{ title: "Checkout" }}
      />
    </BrowseStack.Navigator>
  );
}

function FavoritesStackNavigator() {
  return (
    <FavoritesStack.Navigator>
      <FavoritesStack.Screen name="FavoritesHome" options={{ title: "Favorites" }}>
        {({ navigation }) => (
          <FavoritesScreen
            navigation={navigation as never}
          />
        )}
      </FavoritesStack.Screen>
      <FavoritesStack.Screen
        name="ListingDetail"
        component={ListingDetailScreen}
        options={{ title: "Item" }}
      />
      <FavoritesStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{ title: "Checkout" }}
      />
    </FavoritesStack.Navigator>
  );
}

function SellStackNavigator() {
  return (
    <SellStack.Navigator>
      <SellStack.Screen
        name="SellHome"
        component={SellScreen}
        options={{ title: "Sell" }}
      />
      <SellStack.Screen
        name="ListingDetail"
        component={ListingDetailScreen}
        options={{ title: "Item" }}
      />
    </SellStack.Navigator>
  );
}

function OrdersStackNavigator() {
  return (
    <OrdersStack.Navigator>
      <OrdersStack.Screen
        name="OrdersHome"
        component={OrdersScreen}
        options={{ title: "Orders" }}
      />
      <OrdersStack.Screen
        name="DropOff"
        component={DropOffScreen}
        options={{ title: "Drop off" }}
      />
      <OrdersStack.Screen
        name="Pickup"
        component={PickupScreen}
        options={{ title: "Pick up" }}
      />
    </OrdersStack.Navigator>
  );
}

function MainTabs() {
  const { profile } = useMarketplace();
  const isBuyer = profile?.roles.includes("buyer") ?? false;
  const isSeller = profile?.roles.includes("seller") ?? false;
  const isAdmin = profile?.roles.includes("admin") ?? false;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e5e7eb",
          height: 84,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}>
      {isBuyer ? (
        <Tab.Screen
          name="BrowseTab"
          component={BrowseStackNavigator}
          options={{
            title: "Browse",
            tabBarIcon: ({ color, size }) => (
              <Home color={color} size={size} strokeWidth={2.25} />
            ),
          }}
        />
      ) : null}
      {isBuyer ? (
        <Tab.Screen
          name="FavoritesTab"
          component={FavoritesStackNavigator}
          options={{
            title: "Saved",
            tabBarIcon: ({ color, size }) => (
              <Heart color={color} size={size} strokeWidth={2.25} />
            ),
          }}
        />
      ) : null}
      {isSeller ? (
        <Tab.Screen
          name="SellTab"
          component={SellStackNavigator}
          options={{
            title: "Sell",
            tabBarIcon: ({ color, size }) => (
              <Store color={color} size={size} strokeWidth={2.25} />
            ),
          }}
        />
      ) : null}
      <Tab.Screen
        name="OrdersTab"
        component={OrdersStackNavigator}
        options={{
          title: "Orders",
          tabBarIcon: ({ color, size }) => (
            <Package color={color} size={size} strokeWidth={2.25} />
          ),
        }}
      />
      {isAdmin ? (
        <Tab.Screen
          name="AdminTab"
          component={AdminScreen}
          options={{
            title: "Admin",
            headerShown: true,
            tabBarIcon: ({ color, size }) => (
              <Shield color={color} size={size} strokeWidth={2.25} />
            ),
          }}
        />
      ) : null}
      <Tab.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{
          title: "Account",
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <UserRound color={color} size={size} strokeWidth={2.25} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function SignedInFlow() {
  const { ready, profile } = useMarketplace();

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!profile || profile.roles.length === 0) {
    return <RoleSetupScreen />;
  }

  return <MainTabs />;
}

function AuthFlow() {
  const [emailForCode, setEmailForCode] = useState<string | null>(null);

  if (emailForCode) {
    return (
      <VerifyCodeScreen
        email={emailForCode}
        onBack={() => setEmailForCode(null)}
      />
    );
  }

  return <SignInScreen onCodeSent={setEmailForCode} />;
}

export function RootNavigator() {
  const { status } = useAuth();

  if (status === "booting") {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {status === "signedIn" ? <SignedInFlow /> : <AuthFlow />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f5f7",
  },
});
