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
    activeMode,
    setActiveMode,
    ordersAsBuyer,
    ordersAsSeller,
    myListings,
    favorites,
  } = useMarketplace();
  const roles = profile?.roles ?? [];
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [creditedCents, setCreditedCents] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
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
      })();
    }, []),
  );

  async function selectMode(mode: "buyer" | "seller") {
    await setActiveMode(mode);
    if (!roles.includes(mode)) {
      const next = [
        ...roles.filter((r): r is "buyer" | "seller" => r === "buyer" || r === "seller"),
        mode,
      ];
      // Keep the other role if it was already on.
      const unique = [...new Set(next)] as MarketplaceRole[];
      await setRoles(unique);
    }
  }

  async function toggleAdmin() {
    if (!profile?.adminEligible) return;
    const selfServe = roles.filter(
      (r): r is "buyer" | "seller" => r === "buyer" || r === "seller",
    );
    await setRoles(
      selfServe.length ? selfServe : (["buyer", "seller"] as MarketplaceRole[]),
      undefined,
      !roles.includes("admin"),
    );
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

      <Text style={[styles.heading, styles.section]}>Using app as</Text>
      <Text style={styles.meta}>
        Switch persona for Neighbor vs Pantry tools. Both roles can stay
        enabled.
      </Text>
      <Pressable
        style={[styles.chip, activeMode === "buyer" && styles.chipOn]}
        onPress={() => void selectMode("buyer")}>
        <Text style={styles.chipText}>Neighbor</Text>
      </Pressable>
      <Pressable
        style={[styles.chip, activeMode === "seller" && styles.chipOn]}
        onPress={() => void selectMode("seller")}>
        <Text style={styles.chipText}>Pantry</Text>
      </Pressable>
      {profile?.adminEligible ? (
        <Pressable
          style={[styles.chip, roles.includes("admin") && styles.chipOn]}
          onPress={() => void toggleAdmin()}>
          <Text style={styles.chipText}>Admin (operator)</Text>
          <Text style={styles.meta}>
            {roles.includes("admin")
              ? "Tap to hide Admin tab and ops tools. Neighbor/Pantry stay above."
              : "Tap to restore Admin tab and ops tools."}
          </Text>
        </Pressable>
      ) : null}

      {roles.includes("seller") && paymentsEnabled ? (
        <>
          <Text style={[styles.heading, styles.section]}>Pantry payouts</Text>
          <Text style={styles.meta}>
            Status: {payoutsReady ? "Ready" : "Not set up"}
          </Text>
          {creditedCents > 0 ? (
            <Text style={styles.meta}>
              Waiting for you: ${(creditedCents / 100).toFixed(2)}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {payoutsReady
              ? "Neighbor payment is held until pickup, then transferred to you."
              : "You can list and sell right now. Add a bank account when you want to withdraw — earnings are held for you until then."}
          </Text>
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

      <Text style={[styles.heading, styles.section]}>Activity</Text>
      <Text style={styles.meta}>
        Neighbor orders: {ordersAsBuyer.length}
      </Text>
      <Text style={styles.meta}>Pantry orders: {ordersAsSeller.length}</Text>
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
    marginTop: 6,
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
