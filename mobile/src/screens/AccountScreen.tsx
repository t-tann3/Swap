import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { MarketplaceRole } from "../marketplace/types";

export function AccountScreen() {
  const { me, signOut } = useAuth();
  const {
    profile,
    setRoles,
    ordersAsBuyer,
    ordersAsSeller,
    myListings,
    favorites,
  } = useMarketplace();
  const roles = profile?.roles ?? [];
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const status = await apiRequest<{
            enabled: boolean;
            payoutsReady: boolean;
          }>("/api/payments/connect/status", { auth: true });
          setPaymentsEnabled(status.enabled);
          setPayoutsReady(status.payoutsReady);
        } catch {
          // ignore
        }
      })();
    }, []),
  );

  async function toggle(role: MarketplaceRole) {
    const next = roles.includes(role)
      ? roles.filter(r => r !== role)
      : [...roles, role];
    if (next.length === 0) return;
    await setRoles(next);
  }

  async function startConnect() {
    setConnectBusy(true);
    try {
      const { url } = await apiRequest<{ url: string }>(
        "/api/payments/connect/onboard",
        { method: "POST", auth: true, body: "{}" },
      );
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert(
        "Stripe Connect",
        err instanceof Error ? err.message : "Could not start onboarding",
      );
    } finally {
      setConnectBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Account</Text>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.value}>{me?.email ?? me?.user_id}</Text>
      <Text style={styles.label}>Environment</Text>
      <Text style={styles.value}>{me?.app.environment}</Text>

      <Text style={[styles.heading, styles.section]}>Roles</Text>
      <Pressable
        style={[styles.chip, roles.includes("buyer") && styles.chipOn]}
        onPress={() => void toggle("buyer")}>
        <Text style={styles.chipText}>Buyer</Text>
      </Pressable>
      <Pressable
        style={[styles.chip, roles.includes("seller") && styles.chipOn]}
        onPress={() => void toggle("seller")}>
        <Text style={styles.chipText}>Seller</Text>
      </Pressable>

      {roles.includes("seller") && paymentsEnabled ? (
        <>
          <Text style={[styles.heading, styles.section]}>Seller payouts</Text>
          <Text style={styles.meta}>
            Status: {payoutsReady ? "Ready" : "Setup required"}
          </Text>
          <Text style={styles.meta}>
            Buyer payment is held until pickup, then transferred to you.
          </Text>
          {!payoutsReady ? (
            <Pressable
              style={[styles.button, styles.connectBtn]}
              disabled={connectBusy}
              onPress={() => void startConnect()}>
              <Text style={styles.buttonText}>
                {connectBusy ? "Opening Stripe…" : "Set up Stripe payouts"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={[styles.heading, styles.section]}>Activity</Text>
      <Text style={styles.meta}>Purchases: {ordersAsBuyer.length}</Text>
      <Text style={styles.meta}>Sales: {ordersAsSeller.length}</Text>
      <Text style={styles.meta}>Listings: {myListings.length}</Text>
      <Text style={styles.meta}>Favorites: {favorites.length}</Text>

      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
    padding: 24,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
  },
  section: {
    marginTop: 28,
    fontSize: 18,
  },
  label: {
    fontSize: 12,
    color: "#5c6370",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
  },
  value: {
    fontSize: 16,
    fontWeight: "500",
  },
  chip: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  chipOn: {
    borderColor: "#111827",
  },
  chipText: {
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    fontSize: 15,
    color: "#414651",
    marginBottom: 6,
  },
  button: {
    marginTop: 32,
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  connectBtn: {
    marginTop: 12,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
