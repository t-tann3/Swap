import { useCallback, useState } from "react";
import {
  ActivityIndicator,
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
import type { Order, UserProfile } from "../marketplace/types";

type QueueFilter = "attention" | "stuck" | "disputed" | "frozen" | "overdue";
type ViewMode = "queue" | "all";
type AdminSection = "settings" | "patrons" | "report" | "escrow";

type PatronRow = UserProfile & {
  createdAt?: string;
  updatedAt?: string;
  allocation?: {
    cap: number;
    used: number;
    remaining: number;
    basketUnits: number;
    openOrderUnits: number;
  };
  activity?: {
    ordersAsBuyer: number;
    ordersAsSeller: number;
    openAsBuyer: number;
    completedAsBuyer: number;
    lastOrderAt: string | null;
  };
};

type PantryReport = {
  generatedAt: string;
  pantryMode: boolean;
  summary: {
    unitsOut: number;
    noShows: number;
    stockOuts: number;
    lowStock: number;
    openOrders: number;
    overdueDropOffs: number;
    activeBaskets: number;
    reservedUnits: number;
    completedOrders: number;
  };
};

const PILOT_RUNBOOK = [
  "Confirm Relai keys in server env (sandbox or live RELAI_*).",
  "Turn on Pantry mode below; set default patron cap and basket hold TTL.",
  "Seed or create pantry listings with stock + per-item max on Sell.",
  "Walk a patron: Browse → Basket → Checkout → Placed order.",
  "Seller: Orders → Accept → Drop off basket → Ready for pickup → Completed.",
  "Complete or let no-show sweep finish; check Report numbers.",
  "Use Patrons to raise caps or block a user if needed.",
  "Run sweeps if holds look stuck; abandon TTL clears idle baskets.",
];

const MARKETPLACE_RUNBOOK = [
  "Confirm Relai and Stripe keys in server env.",
  "Turn pantry mode off so commerce and escrow are active.",
  "Sellers complete Stripe Connect payouts from Account.",
  "Use Escrow tab for stuck transfers, disputes, and holds.",
];

export function AdminScreen() {
  const { profile, refresh, pantryMode } = useMarketplace();
  const isAdmin = profile?.roles.includes("admin") ?? false;
  const [view, setView] = useState<ViewMode>("queue");
  const [filter, setFilter] = useState<QueueFilter>("attention");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pantryEnabled, setPantryEnabled] = useState(false);
  const [defaultCap, setDefaultCap] = useState(5);
  const [basketTtl, setBasketTtl] = useState(120);
  const [lowStock, setLowStock] = useState(3);
  const [pantryBusy, setPantryBusy] = useState(false);
  const [patrons, setPatrons] = useState<PatronRow[]>([]);
  const [report, setReport] = useState<PantryReport | null>(null);
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
  const [section, setSection] = useState<AdminSection>("patrons");
  const [patronQuery, setPatronQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    if (view === "all") {
      const res = await apiRequest<{ data: Order[] }>(
        `/api/admin/orders?status=all`,
        { auth: true },
      );
      setOrders(res.data);
      return;
    }
    const res = await apiRequest<{ data: Order[] }>(
      `/api/admin/orders/escrow?filter=${filter}`,
      { auth: true },
    );
    setOrders(res.data);
  }, [view, filter]);

  const loadPantry = useCallback(async () => {
    const s = await apiRequest<{
      enabled: boolean;
      defaultPatronCap: number;
      basketHoldTtlMinutes: number;
      lowStockThreshold: number;
    }>("/api/admin/pantry", { auth: true });
    setPantryEnabled(s.enabled);
    setDefaultCap(s.defaultPatronCap);
    setBasketTtl(s.basketHoldTtlMinutes);
    setLowStock(s.lowStockThreshold);
  }, []);

  const loadPatrons = useCallback(async () => {
    const res = await apiRequest<{ data: PatronRow[] }>("/api/admin/patrons", {
      auth: true,
    });
    setPatrons(res.data);
    const drafts: Record<string, string> = {};
    for (const p of res.data) {
      drafts[p.userId] = String(p.patronCap ?? "");
    }
    setCapDrafts(drafts);
  }, []);

  const loadReport = useCallback(async () => {
    const res = await apiRequest<PantryReport>("/api/admin/pantry/report", {
      auth: true,
    });
    setReport(res);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void Promise.all([load(), loadPantry(), loadPatrons(), loadReport()])
        .catch(err => {
          setError(err instanceof Error ? err.message : "Failed to load");
        })
        .finally(() => setLoading(false));
    }, [isAdmin, load, loadPantry, loadPatrons, loadReport]),
  );

  async function savePantry() {
    setPantryBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest("/api/admin/pantry", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({
          enabled: pantryEnabled,
          defaultPatronCap: defaultCap,
          basketHoldTtlMinutes: basketTtl,
          lowStockThreshold: lowStock,
        }),
      });
      setMessage(
        pantryEnabled
          ? "Pantry settings saved — free handoffs, no payments or disputes."
          : "Pantry mode off — marketplace commerce restored (if Stripe is configured).",
      );
      await refresh();
      await loadReport();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save pantry settings",
      );
    } finally {
      setPantryBusy(false);
    }
  }

  async function savePatron(
    userId: string,
    patch: {
      patronCap?: number | null;
      pantryBlocked?: boolean;
      isPantrySeller?: boolean;
    },
  ) {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/patrons/${userId}/cap`, {
        method: "PUT",
        auth: true,
        body: JSON.stringify(patch),
      });
      setMessage("Patron updated.");
      await loadPatrons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update patron");
    } finally {
      setBusyId(null);
    }
  }

  async function run(
    orderId: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setBusyId(orderId);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(path, {
        method: "POST",
        auth: true,
        body: JSON.stringify(body ?? {}),
      });
      setMessage("Updated.");
      await load();
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function runSweeps() {
    setBusyId("sweeps");
    setError(null);
    setMessage(null);
    try {
      await apiRequest("/api/admin/sweeps/run", {
        method: "POST",
        auth: true,
        body: "{}",
      });
      setMessage("Sweeps finished (including abandoned baskets).");
      await load();
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sweep failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Admin role required.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const filters: QueueFilter[] = [
    "attention",
    "disputed",
    "stuck",
    "frozen",
    "overdue",
  ];

  const reportMetrics: [string, number][] = report
    ? [
        ["Units out", report.summary.unitsOut],
        ["No-shows", report.summary.noShows],
        ["Stock-outs", report.summary.stockOuts],
        ["Low stock", report.summary.lowStock],
        ["Open orders", report.summary.openOrders],
        ["Overdue drop-offs", report.summary.overdueDropOffs],
      ]
    : [];

  const sections: { id: AdminSection; label: string }[] = [
    { id: "patrons", label: "Patrons" },
    { id: "settings", label: "Settings" },
    { id: "report", label: "Report" },
    ...(pantryMode ? [] : [{ id: "escrow" as const, label: "Escrow" }]),
  ];

  const activeSection =
    pantryMode && section === "escrow" ? "patrons" : section;

  const filteredPatrons = patrons.filter(p => {
    const q = patronQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.name ?? "").toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q) ||
      p.userId.toLowerCase().includes(q) ||
      p.roles.join(" ").toLowerCase().includes(q)
    );
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Admin</Text>
      <Text style={styles.help}>
        {pantryMode
          ? "Patron directory, pantry settings, and reporting. No payments or escrow in pantry mode."
          : "See who is on the platform, manage settings, and resolve escrow."}
      </Text>

      <View style={styles.queueFilters}>
        {sections.map(s => (
          <Pressable
            key={s.id}
            style={[styles.chip, activeSection === s.id && styles.chipOn]}
            onPress={() => setSection(s.id)}>
            <Text
              style={[styles.chipText, activeSection === s.id && styles.chipTextOn]}>
              {s.label}
              {s.id === "patrons" && patrons.length > 0
                ? ` · ${patrons.length}`
                : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.meta}>{message}</Text> : null}

      {activeSection === "settings" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>
              {pantryMode ? "Pilot runbook" : "Ops runbook"}
            </Text>
            {(pantryMode ? PILOT_RUNBOOK : MARKETPLACE_RUNBOOK).map((step, i) => (
              <Text key={step} style={styles.runbookStep}>
                {i + 1}. {step}
              </Text>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Pantry settings</Text>
            <Text style={styles.cardHelp}>
              Free food handoffs with baskets and inventory holds. No Stripe,
              escrow, payouts, or disputes while this is on.
            </Text>
            <Pressable
              style={[
                styles.chip,
                styles.chipBlock,
                pantryEnabled && styles.chipOn,
              ]}
              onPress={() => setPantryEnabled(v => !v)}>
              <Text
                style={[styles.chipText, pantryEnabled && styles.chipTextOn]}>
                {pantryEnabled ? "Enabled" : "Disabled"}
              </Text>
            </Pressable>
            <Text style={styles.fieldLabel}>Default patron cap</Text>
            <TextInput
              style={styles.input}
              value={String(defaultCap)}
              onChangeText={t => setDefaultCap(Number(t) || 1)}
              keyboardType="number-pad"
            />
            <Text style={styles.fieldLabel}>Basket hold TTL (min)</Text>
            <TextInput
              style={styles.input}
              value={String(basketTtl)}
              onChangeText={t => setBasketTtl(Number(t) || 0)}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>0 = never auto-clear idle baskets</Text>
            <Text style={styles.fieldLabel}>Low-stock at ≤</Text>
            <TextInput
              style={styles.input}
              value={String(lowStock)}
              onChangeText={t => setLowStock(Number(t) || 0)}
              keyboardType="number-pad"
            />
            <Pressable
              style={[
                styles.actionBtn,
                styles.saveBtn,
                pantryBusy && styles.disabled,
              ]}
              disabled={pantryBusy}
              onPress={() => void savePantry()}>
              <Text style={styles.actionText}>
                {pantryBusy ? "Saving…" : "Save pantry settings"}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {activeSection === "report" ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>Pantry report</Text>
            <Pressable style={styles.smallBtn} onPress={() => void loadReport()}>
              <Text style={styles.smallBtnText}>Refresh</Text>
            </Pressable>
          </View>
          {report ? (
            <>
              <Text style={styles.meta}>
                As of {new Date(report.generatedAt).toLocaleString()}
              </Text>
              <View style={styles.metrics}>
                {reportMetrics.map(([label, value]) => (
                  <View key={label} style={styles.metric}>
                    <Text style={styles.metricLabel}>{label}</Text>
                    <Text style={styles.metricValue}>{value}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>Use web for CSV export.</Text>
            </>
          ) : (
            <Text style={styles.meta}>Loading report…</Text>
          )}
        </View>
      ) : null}

      {activeSection === "patrons" ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>Patron accounts</Text>
            <Pressable style={styles.smallBtn} onPress={() => void loadPatrons()}>
              <Text style={styles.smallBtnText}>Refresh</Text>
            </Pressable>
          </View>
          <Text style={styles.cardHelp}>
            Everyone with buyer or seller role — {patrons.length} account
            {patrons.length === 1 ? "" : "s"} on the platform.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Search name, email, role…"
            value={patronQuery}
            onChangeText={setPatronQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {filteredPatrons.length === 0 ? (
            <Text style={styles.meta}>
              {patrons.length === 0
                ? "No patron accounts yet."
                : "No accounts match that search."}
            </Text>
          ) : (
            filteredPatrons.map(p => (
              <View key={p.userId} style={styles.patronRow}>
                <Text style={styles.patronName}>
                  {p.name ?? p.email ?? p.userId}
                  {p.pantryBlocked ? " · Blocked" : ""}
                </Text>
                <Text style={styles.meta}>{p.email ?? "No email"}</Text>
                <Text style={styles.meta}>
                  Roles: {p.roles.join(", ") || "none"}
                  {p.isPantrySeller ? " · pantry seller" : ""}
                </Text>
                <Text style={styles.meta}>
                  Cap {p.allocation?.used ?? 0}/{p.allocation?.cap ?? "—"} ·
                  Orders {p.activity?.completedAsBuyer ?? 0} completed
                  {(p.activity?.openAsBuyer ?? 0) > 0
                    ? ` · ${p.activity?.openAsBuyer} open`
                    : ""}
                  {(p.activity?.ordersAsSeller ?? 0) > 0
                    ? ` · ${p.activity?.ordersAsSeller} as seller`
                    : ""}
                </Text>
                <Text style={styles.meta}>
                  Joined{" "}
                  {p.createdAt
                    ? new Date(p.createdAt).toLocaleDateString()
                    : "—"}
                  {p.activity?.lastOrderAt
                    ? ` · last order ${new Date(
                        p.activity.lastOrderAt,
                      ).toLocaleDateString()}`
                    : " · no orders yet"}
                </Text>
                <View style={styles.patronActions}>
                  <TextInput
                    style={styles.capInput}
                    placeholder="cap"
                    value={capDrafts[p.userId] ?? ""}
                    onChangeText={t =>
                      setCapDrafts(d => ({ ...d, [p.userId]: t }))
                    }
                    keyboardType="number-pad"
                  />
                  <Pressable
                    style={[
                      styles.outlineBtn,
                      busyId === p.userId && styles.disabled,
                    ]}
                    disabled={busyId === p.userId}
                    onPress={() => {
                      const raw = (capDrafts[p.userId] ?? "").trim();
                      const patronCap =
                        raw === ""
                          ? null
                          : Math.max(
                              1,
                              Math.min(50, Number.parseInt(raw, 10) || 1),
                            );
                      void savePatron(p.userId, { patronCap });
                    }}>
                    <Text style={styles.outlineBtnText}>Save cap</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.outlineBtn,
                      busyId === p.userId && styles.disabled,
                    ]}
                    disabled={busyId === p.userId}
                    onPress={() =>
                      void savePatron(p.userId, {
                        pantryBlocked: !p.pantryBlocked,
                      })
                    }>
                    <Text style={styles.outlineBtnText}>
                      {p.pantryBlocked ? "Unblock" : "Block"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}

      {activeSection === "escrow" ? (
        <>
          <View style={styles.queueFilters}>
            <Pressable
              style={[styles.chip, view === "queue" && styles.chipOn]}
              onPress={() => setView("queue")}>
              <Text
                style={[
                  styles.chipText,
                  view === "queue" && styles.chipTextOn,
                ]}>
                Escrow queue
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, view === "all" && styles.chipOn]}
              onPress={() => setView("all")}>
              <Text
                style={[styles.chipText, view === "all" && styles.chipTextOn]}>
                All orders
              </Text>
            </Pressable>
            {view === "queue"
              ? filters.map(f => (
                  <Pressable
                    key={f}
                    style={[styles.chip, filter === f && styles.chipOn]}
                    onPress={() => setFilter(f)}>
                    <Text
                      style={[
                        styles.chipText,
                        filter === f && styles.chipTextOn,
                      ]}>
                      {f}
                    </Text>
                  </Pressable>
                ))
              : null}
          </View>
          {view === "queue" ? (
            <Pressable
              style={[
                styles.actionBtn,
                styles.saveBtn,
                busyId === "sweeps" && styles.disabled,
              ]}
              disabled={busyId === "sweeps"}
              onPress={() => void runSweeps()}>
              <Text style={styles.actionText}>Run sweeps</Text>
            </Pressable>
          ) : null}

          {orders.length === 0 ? (
            <Text style={styles.meta}>
              {view === "all" ? "No orders yet." : "No orders in this queue."}
            </Text>
          ) : (
            orders.map(order => (
              <View key={order.id} style={styles.card}>
                <Text style={styles.title}>
                  {order.listing?.title ?? order.listingId}
                </Text>
                <Text style={styles.meta}>{order.id}</Text>
                <Text style={styles.meta}>
                  Status: {order.status}
                  {order.completedReason ? ` (${order.completedReason})` : ""}
                </Text>
                <Text style={styles.meta}>
                  Payment: {order.paymentStatus ?? "—"}
                </Text>
                {view === "queue" ? (
                  <View style={styles.stack}>
                    <Action
                      label="Force release"
                      disabled={busyId === order.id}
                      onPress={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/force-release`,
                          { overrideDispute: false },
                        )
                      }
                    />
                    <Action
                      label="Force refund"
                      disabled={busyId === order.id}
                      onPress={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/force-refund`,
                        )
                      }
                    />
                    <Action
                      label="Retry transfer"
                      disabled={busyId === order.id}
                      onPress={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/retry-transfer`,
                        )
                      }
                    />
                  </View>
                ) : null}
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: "#f4f5f7",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f5f7",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  help: {
    fontSize: 14,
    color: "#5c6370",
    marginBottom: 20,
    lineHeight: 20,
  },
  cardHelp: {
    fontSize: 14,
    color: "#5c6370",
    marginTop: 8,
    marginBottom: 16,
    lineHeight: 20,
  },
  runbookStep: {
    marginTop: 8,
    fontSize: 13,
    color: "#374151",
    lineHeight: 19,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: -4,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  smallBtn: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  metric: {
    width: "47%",
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    padding: 12,
  },
  metricLabel: {
    fontSize: 11,
    color: "#5c6370",
    fontWeight: "600",
  },
  metricValue: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "700",
  },
  patronRow: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 12,
    marginTop: 12,
  },
  patronName: {
    fontSize: 15,
    fontWeight: "700",
  },
  patronActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  capInput: {
    width: 72,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  outlineBtn: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  outlineBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
  queueFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
    marginTop: 4,
  },
  chip: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  chipBlock: {
    alignSelf: "stretch",
    marginBottom: 12,
  },
  chipOn: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
    textTransform: "capitalize",
  },
  chipTextOn: {
    color: "#fff",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    marginTop: 8,
    fontSize: 13,
    color: "#5c6370",
  },
  message: {
    color: "#374151",
    marginBottom: 8,
    fontSize: 13,
  },
  error: {
    color: "#b42318",
    marginTop: 8,
    marginBottom: 8,
  },
  actions: {
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtn: {
    marginTop: 4,
  },
  actionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  disabled: {
    opacity: 0.5,
  },
});
