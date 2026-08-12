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
import type { PantryTeam } from "../marketplace/types";

type TeamRow = {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "Invited" | "Accepted";
  role: string | null;
  kind: "member" | "invite";
  id: string;
};

export function TeamScreen() {
  const { profile, pantryMode } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [team, setTeam] = useState<PantryTeam | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!pantryMode || !isSeller) {
      setTeam(null);
      return;
    }
    try {
      setTeam(await apiRequest<PantryTeam>("/api/me/pantry", { auth: true }));
    } catch {
      setTeam(null);
    }
  }, [pantryMode, isSeller]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isOwner = team?.role === "owner";
  const rows: TeamRow[] = [
    ...(team?.members ?? []).map(m => ({
      key: `m-${m.userId}`,
      firstName: m.firstName ?? "",
      lastName: m.lastName ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
      status: "Accepted" as const,
      role: m.role,
      kind: "member" as const,
      id: m.userId,
    })),
    ...(team?.invites ?? []).map(inv => ({
      key: `i-${inv.id}`,
      firstName: inv.firstName ?? "",
      lastName: inv.lastName ?? "",
      email: inv.email,
      phone: inv.phone ?? "",
      status: "Invited" as const,
      role: null,
      kind: "invite" as const,
      id: inv.id,
    })),
  ];

  async function sendInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await apiRequest("/api/me/pantry/invites", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          email: trimmed,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      await load();
      Alert.alert(
        "Invite sent",
        `${trimmed} can join when they sign in with that email.`,
      );
    } catch (err) {
      Alert.alert(
        "Invite failed",
        err instanceof Error ? err.message : "Could not invite",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row: TeamRow) {
    setBusy(true);
    try {
      if (row.kind === "member") {
        await apiRequest(`/api/me/pantry/members/${row.id}`, {
          method: "DELETE",
          auth: true,
        });
      } else {
        await apiRequest(`/api/me/pantry/invites/${row.id}`, {
          method: "DELETE",
          auth: true,
        });
      }
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

  if (!isSeller) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Team</Text>
        <Text style={styles.meta}>Pantry role required.</Text>
      </View>
    );
  }

  if (!pantryMode) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Team</Text>
        <Text style={styles.meta}>
          Team management is available when pantry mode is on.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Team</Text>
      <Text style={styles.meta}>
        {isOwner
          ? "Invite staff by email. Members can stock, accept, and drop off — only you can invite."
          : team?.role === "member"
            ? "You are a member of this pantry."
            : "Your pantry team will appear here."}
      </Text>
      {team?.pantry ? (
        <Text style={styles.meta}>
          {team.pantry.name} · your role: {team.role}
        </Text>
      ) : null}

      {isOwner ? (
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>Invite member</Text>
          <TextInput
            style={styles.input}
            placeholder="First name"
            value={firstName}
            onChangeText={setFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            value={lastName}
            onChangeText={setLastName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <Pressable
            style={[styles.button, busy && styles.disabled]}
            disabled={busy || !email.trim()}
            onPress={() => void sendInvite()}>
            <Text style={styles.buttonText}>
              {busy ? "Inviting…" : "Invite"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.cell, styles.headerCell, styles.flexName]}>
            Name
          </Text>
          <Text style={[styles.cell, styles.headerCell, styles.flexEmail]}>
            Email
          </Text>
          <Text style={[styles.cell, styles.headerCell, styles.flexStatus]}>
            Status
          </Text>
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>No team members yet.</Text>
        ) : (
          rows.map(row => (
            <View key={row.key} style={styles.tableRow}>
              <View style={styles.flexName}>
                <Text style={styles.name}>
                  {[row.firstName, row.lastName].filter(Boolean).join(" ") ||
                    "—"}
                </Text>
                <Text style={styles.phone}>{row.phone || "No phone"}</Text>
              </View>
              <Text style={[styles.cell, styles.flexEmail]} numberOfLines={2}>
                {row.email || "—"}
              </Text>
              <View style={styles.flexStatus}>
                <Text style={styles.status}>
                  {row.status}
                  {row.role === "owner" ? " · owner" : ""}
                </Text>
                {isOwner && row.role !== "owner" ? (
                  <Pressable
                    disabled={busy}
                    onPress={() => void removeRow(row)}>
                    <Text style={styles.link}>
                      {row.kind === "invite" ? "Revoke" : "Remove"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f4f5f7" },
  container: { padding: 24, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: "700", color: "#111827" },
  meta: { marginTop: 8, fontSize: 14, color: "#4b5563", lineHeight: 20 },
  inviteCard: {
    marginTop: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  inviteLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 15,
  },
  button: {
    marginTop: 4,
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
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f9fafb",
    gap: 8,
  },
  cell: { fontSize: 13, color: "#374151" },
  headerCell: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  flexName: { flex: 1.2 },
  flexEmail: { flex: 1.3 },
  flexStatus: { flex: 1, alignItems: "flex-start", gap: 4 },
  name: { fontSize: 14, fontWeight: "600", color: "#111827" },
  phone: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  status: { fontSize: 12, fontWeight: "600", color: "#047857" },
  link: { fontSize: 13, fontWeight: "600", color: "#b91c1c" },
  empty: {
    padding: 20,
    textAlign: "center",
    color: "#6b7280",
    fontSize: 14,
  },
});
