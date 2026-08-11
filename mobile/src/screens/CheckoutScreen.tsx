import type { ExchangeZone } from "@relai-team/access-sdk";
import { RelaiApiError } from "@relai-team/access-sdk";
import { useStripe } from "@stripe/stripe-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { Listing } from "../marketplace/types";
import { getRelai } from "../relai/client";

type Props = {
  route: { params: { listingId: string } };
  navigation: { popToTop: () => void };
};

function formatNextOpen(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function CheckoutScreen({ route, navigation }: Props) {
  const { buyListing, paymentsEnabled: paymentsFromContext } = useMarketplace();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [listing, setListing] = useState<Listing | null>(null);
  const [zones, setZones] = useState<ExchangeZone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [paymentsOn, setPaymentsOn] = useState(paymentsFromContext);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [item, ezList, payCfg] = await Promise.all([
        apiRequest<Listing>(`/api/listings/${route.params.listingId}`),
        getRelai().exchangeZones.list({ limit: 50 }),
        apiRequest<{ enabled: boolean }>("/api/payments/config"),
      ]);
      setListing(item);
      setZones(ezList);
      setPaymentsOn(payCfg.enabled);
      setSelectedId(prev => {
        if (prev && ezList.some(z => z.id === prev)) return prev;
        return (
          ezList.find(z => z.is_open_now && z.nodes_available > 0)?.id ?? null
        );
      });
    } catch (err) {
      if (err instanceof RelaiApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          message: err instanceof Error ? err.message : "Could not load checkout",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [route.params.listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void apiRequest<{ enabled: boolean }>("/api/payments/config")
        .then(cfg => setPaymentsOn(cfg.enabled))
        .catch(() => undefined);
    }, []),
  );

  const selected = zones.find(z => z.id === selectedId) ?? null;
  const canContinue =
    !!listing &&
    !!selected &&
    selected.is_open_now &&
    selected.nodes_available > 0 &&
    !busy;

  async function authorizePayment(listingId: string): Promise<string> {
    const pi = await apiRequest<{
      clientSecret: string;
      paymentIntentId: string;
    }>("/api/payments/payment-intents", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ listingId }),
    });

    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: pi.clientSecret,
      merchantDisplayName: "Swap",
      allowsDelayedPaymentMethods: false,
    });
    if (initError) {
      throw new Error(initError.message);
    }

    const { error: presentError } = await presentPaymentSheet();
    if (presentError) {
      if (presentError.code === "Canceled") {
        throw new Error("Payment canceled");
      }
      throw new Error(presentError.message);
    }

    return pi.paymentIntentId;
  }

  async function onContinue() {
    if (!listing || !selected || !canContinue) return;
    setBusy(true);
    try {
      // Always re-check — avoids stale "payments off" from an earlier app launch.
      const payCfg = await apiRequest<{ enabled: boolean }>(
        "/api/payments/config",
      );
      setPaymentsOn(payCfg.enabled);

      let paymentIntentId: string | undefined;
      if (payCfg.enabled) {
        try {
          paymentIntentId = await authorizePayment(listing.id);
        } catch (err) {
          if (err instanceof Error && err.message === "Payment canceled") {
            return;
          }
          throw err;
        }
      }

      await buyListing(listing.id, {
        exchangeZoneId: selected.id,
        exchangeZoneName: selected.name,
        exchangeZoneAddress: selected.address,
        paymentIntentId,
      });
      Alert.alert(
        "Order placed",
        payCfg.enabled
          ? `Payment authorized. Exchange Zone: ${selected.name}. Funds release to the pantry when you pick up.`
          : `Exchange Zone: ${selected.name}. The pantry must accept, then drop off, before your pickup link appears in Orders.`,
        [{ text: "OK", onPress: () => navigation.popToTop() }],
      );
    } catch (err) {
      Alert.alert(
        "Checkout failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !listing) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          {error?.code ? `[${error.code}] ` : ""}
          {error?.message ?? "Listing not found."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Checkout</Text>
      <Text style={styles.title}>{listing.title}</Text>
      {paymentsOn ? (
        <Text style={styles.price}>
          ${(listing.priceCents / 100).toFixed(2)} · escrow until pickup
        </Text>
      ) : null}

      <Text style={styles.section}>Choose Exchange Zone</Text>
      {paymentsOn ? (
        <Text style={styles.hint}>
          Next you’ll authorize payment on a Stripe sheet. The order is placed
          only after the card is authorized; the pantry can then accept.
        </Text>
      ) : null}
      <FlatList
        data={zones}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.error}>No Exchange Zones available.</Text>
        }
        renderItem={({ item }) => {
          const selectable = item.is_open_now && item.nodes_available > 0;
          const active = selectedId === item.id;
          return (
            <Pressable
              disabled={!selectable}
              onPress={() => setSelectedId(item.id)}
              style={[
                styles.card,
                active && styles.cardOn,
                !selectable && styles.cardDisabled,
              ]}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text
                  style={[
                    styles.badge,
                    item.is_open_now ? styles.badgeOpen : styles.badgeClosed,
                  ]}>
                  {item.is_open_now ? "Open now" : "Closed"}
                </Text>
              </View>
              {item.address ? (
                <Text style={styles.meta}>{item.address}</Text>
              ) : null}
              <Text style={styles.meta}>
                {item.nodes_available} compartments available
                {item.is_simulated ? " · Simulated" : ""}
              </Text>
              {!item.is_open_now ? (
                <Text style={styles.closedNote}>
                  {item.next_open_at
                    ? `Opens ${formatNextOpen(item.next_open_at, item.timezone)}`
                    : "No upcoming open time"}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />

      <Pressable
        style={[styles.button, !canContinue && styles.buttonDisabled]}
        disabled={!canContinue}
        onPress={() => void onContinue()}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {paymentsOn ? "Continue to payment" : "Place order"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f4f5f7",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  price: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  section: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
  hint: {
    fontSize: 13,
    color: "#5c6370",
    marginBottom: 10,
    lineHeight: 18,
  },
  list: {
    paddingBottom: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardOn: {
    borderColor: "#111827",
  },
  cardDisabled: {
    opacity: 0.55,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontWeight: "600",
    fontSize: 15,
  },
  badge: {
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeOpen: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  badgeClosed: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },
  meta: {
    marginTop: 4,
    color: "#5c6370",
    fontSize: 13,
  },
  closedNote: {
    marginTop: 8,
    color: "#b42318",
    fontWeight: "600",
    fontSize: 13,
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#b42318",
    textAlign: "center",
  },
});
