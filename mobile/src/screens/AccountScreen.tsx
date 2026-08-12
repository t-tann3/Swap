import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useMarketplace } from "../marketplace/MarketplaceContext";

export function AccountScreen() {
  const { me, signOut } = useAuth();
  const {
    ordersAsBuyer,
    ordersAsSeller,
    myListings,
    favorites,
    pantryMode,
    profile,
  } = useMarketplace();
  const roles = profile?.roles ?? [];
  const isNeighbor = roles.includes("buyer") && !roles.includes("seller");
  const isPantry = roles.includes("seller") && !roles.includes("buyer");
  const isAdmin =
    roles.includes("admin") &&
    !roles.includes("buyer") &&
    !roles.includes("seller");
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [creditedCents, setCreditedCents] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (isPantry && !pantryMode) {
          try {
            const status = await apiRequest<{
              enabled: boolean;
              payoutsReady: boolean;
              creditedCents?: number;
            }>("/api/payments/connect/status", { auth: true });
            setPaymentsEnabled(status.enabled);
            setPayoutsReady(status.payoutsReady);
            setCreditedCents(status.creditedCents ?? 0);
          } catch {
            // ignore
          }
        } else {
          setPaymentsEnabled(false);
        }
      })();
    }, [isPantry, pantryMode]),
  );

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Account</Text>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.value}>{me?.email ?? me?.user_id}</Text>
      <Text style={styles.label}>Account type</Text>
      <Text style={styles.value}>
        {isAdmin
          ? "Admin account"
          : isPantry
            ? "Pantry account"
            : "Neighbor account"}
      </Text>

      {isPantry && paymentsEnabled && !pantryMode ? (
        <>
          <Text style={[styles.heading, styles.section]}>Seller payouts</Text>
          <Text style={styles.meta}>
            Status: {payoutsReady ? "Ready" : "Not set up"}
          </Text>
          {creditedCents > 0 ? (
            <Text style={styles.meta}>
              Waiting for you: ${(creditedCents / 100).toFixed(2)}
            </Text>
          ) : null}
          {!payoutsReady ? (
            <Pressable
              style={[styles.button, styles.connectBtn]}
              disabled={connectBusy}
              onPress={() => void startConnect()}>
              <Text style={styles.buttonText}>
                {connectBusy
                  ? "Opening Stripe…"
                  : creditedCents > 0
                    ? "Withdraw earnings"
                    : "Set up payouts"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {!isAdmin ? (
        <>
          <Text style={[styles.heading, styles.section]}>Activity</Text>
          {isNeighbor ? (
            <>
              <Text style={styles.meta}>Orders: {ordersAsBuyer.length}</Text>
              <Text style={styles.meta}>Saved: {favorites.length}</Text>
            </>
          ) : (
            <>
              <Text style={styles.meta}>
                Pantry orders: {ordersAsSeller.length}
              </Text>
              <Text style={styles.meta}>Listings: {myListings.length}</Text>
            </>
          )}
        </>
      ) : null}

      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
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
    paddingBottom: 48,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  section: {
    marginTop: 28,
    fontSize: 18,
  },
  label: {
    marginTop: 12,
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  meta: {
    marginTop: 6,
    fontSize: 14,
    color: "#4b5563",
    lineHeight: 20,
  },
  button: {
    marginTop: 28,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  connectBtn: {
    marginTop: 12,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
