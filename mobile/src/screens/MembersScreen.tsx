import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { apiRequest } from "../api/client";
import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { PantryPatronRoster } from "../marketplace/types";

export function MembersScreen() {
  const { profile, pantryMode } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [roster, setRoster] = useState<PantryPatronRoster | null>(null);
  const [csvText, setCsvText] = useState(
    "email,first_name,last_name,phone\n",
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!pantryMode || !isSeller) {
      setRoster(null);
      return;
    }
    try {
      setRoster(
        await apiRequest<PantryPatronRoster>("/api/me/pantry/patrons", {
          auth: true,
        }),
      );
    } catch {
      setRoster(null);
    }
  }, [pantryMode, isSeller]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isOwner = roster?.role === "owner";
  const enforceOn = roster?.pantry?.patronAllowlistEnabled ?? false;

  async function toggleEnforce() {
    setBusy(true);
    try {
      await apiRequest("/api/me/pantry/patrons/settings", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ patronAllowlistEnabled: !enforceOn }),
      });
      await load();
    } catch (err) {
      Alert.alert(
        "Could not update",
        err instanceof Error ? err.message : "Try again",
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv() {
    const csv = csvText.trim();
    if (!csv) return;
    setBusy(true);
    try {
      const result = await apiRequest<{
        added: number;
        updated: number;
        skipped: number;
      }>("/api/me/pantry/patrons/upload", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ csv }),
      });
      await load();
      Alert.alert(
        "Uploaded",
        `${result.added} added, ${result.updated} updated` +
          (result.skipped ? `, ${result.skipped} skipped` : "") +
          ".",
      );
    } catch (err) {
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Could not upload CSV",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePatron(id: string) {
    setBusy(true);
    try {
      await apiRequest(`/api/me/pantry/patrons/${id}`, {
        method: "DELETE",
        auth: true,
      });
      await load();
    } catch (err) {
      Alert.alert(
        "Could not remove",
        err instanceof Error ? err.message : "Try again",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!isSeller) {
    return (
      <View style={styles.pad}>
        <Text style={styles.heading}>Members</Text>
        <Text style={styles.meta}>Pantry role required.</Text>
      </View>
    );
  }

  if (!pantryMode) {
    return (
      <View style={styles.pad}>
        <Text style={styles.heading}>Members</Text>
        <Text style={styles.meta}>
          Member lists are available when pantry mode is on.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
      <Text style={styles.heading}>Members</Text>
      <Text style={styles.meta}>
        Upload verified neighbors by email. When enforcement is on, only matched
        emails can shop from your pantry.
      </Text>

      {isOwner ? (
        <View style={styles.card}>
          <Text style={styles.label}>Restrict shopping</Text>
          <Text style={styles.meta}>
            {enforceOn
              ? "On — only listed neighbors can shop."
              : "Off — any neighbor can shop."}
          </Text>
          <Pressable
            style={[styles.button, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void toggleEnforce()}>
            <Text style={styles.buttonText}>
              {enforceOn ? "Enforcement on" : "Enforcement off"}
            </Text>
          </Pressable>
          <Text style={[styles.label, styles.mt]}>Paste CSV</Text>
          <Text style={styles.meta}>
            Columns: email, first_name, last_name, phone
          </Text>
          <TextInput
            style={styles.csvInput}
            multiline
            value={csvText}
            onChangeText={setCsvText}
            autoCapitalize="none"
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.button, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void uploadCsv()}>
            <Text style={styles.buttonText}>
              {busy ? "…" : "Upload list"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.meta}>
          Only the pantry owner can upload the list or change enforcement.
        </Text>
      )}

      <View style={styles.table}>
        {(roster?.patrons ?? []).length === 0 ? (
          <Text style={styles.empty}>No verified members uploaded yet.</Text>
        ) : (
          (roster?.patrons ?? []).map(row => (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.name}>
                  {[row.firstName, row.lastName].filter(Boolean).join(" ") ||
                    "—"}
                </Text>
                <Text style={styles.email}>{row.email}</Text>
                <Text style={styles.phone}>{row.phone || "No phone"}</Text>
                <Text style={styles.status}>
                  {row.status === "matched" ? "Matched" : "Listed"}
                </Text>
              </View>
              {isOwner ? (
                <Pressable
                  disabled={busy}
                  onPress={() => void removePatron(row.id)}>
                  <Text style={styles.link}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f4f5f7" },
  pad: { padding: 24, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: "700", color: "#111827" },
  meta: { marginTop: 8, fontSize: 14, color: "#4b5563", lineHeight: 20 },
  card: {
    marginTop: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  mt: { marginTop: 20 },
  csvInput: {
    marginTop: 10,
    minHeight: 120,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    fontFamily: "Menlo",
    backgroundColor: "#fafafa",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  table: {
    marginTop: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f9fafb",
    gap: 10,
  },
  rowBody: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: "#111827" },
  email: { marginTop: 2, fontSize: 13, color: "#374151" },
  phone: { marginTop: 2, fontSize: 12, color: "#6b7280" },
  status: { marginTop: 4, fontSize: 12, fontWeight: "600", color: "#047857" },
  link: { fontSize: 13, fontWeight: "600", color: "#b91c1c" },
  empty: {
    padding: 20,
    textAlign: "center",
    color: "#6b7280",
    fontSize: 14,
  },
});
