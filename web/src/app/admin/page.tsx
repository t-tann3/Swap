"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useMarketplace } from "../../context/MarketplaceContext";
import { API_BASE_URL, apiRequest } from "../../lib/api";
import { getRelai } from "../../lib/relai/client";
import type { Order, UserProfile } from "../../lib/types";

type QueueFilter = "attention" | "stuck" | "disputed" | "frozen" | "overdue";
type ViewMode = "queue" | "all";
type AdminSection = "settings" | "patrons" | "report" | "escrow";

type ListResponse = {
  filter?: string;
  status?: string;
  count: number;
  data: Order[];
};

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
  daily: { date: string; unitsOut: number; noShows: number; orders: number }[];
};

const PILOT_RUNBOOK = [
  "Confirm Relai keys in server env (sandbox or live RELAI_*).",
  "Turn on Pantry mode below; set default patron cap and basket hold TTL.",
  "Seed or create pantry listings with stock + per-item max on Sell.",
  "Walk a patron: Browse → Basket → Checkout → Placed order.",
  "Pantry: Orders → Accept → Drop off basket → Ready for pickup → Completed.",
  "Complete or let no-show sweep finish; check Report numbers.",
  "Use Patrons to raise caps or block a user if needed.",
  "Run sweeps if holds look stuck; abandon TTL clears idle baskets.",
];

const MARKETPLACE_RUNBOOK = [
  "Confirm Relai and Stripe keys in server env.",
  "Turn pantry mode off so commerce and escrow are active.",
  "Pantry operators complete Stripe Connect payouts from Account.",
  "Use Escrow tab for stuck transfers, disputes, and holds.",
];

export default function AdminPage() {
  const { profile, ready, refresh, pantryMode } = useMarketplace();
  const router = useRouter();
  const isAdmin = profile?.roles.includes("admin") ?? false;
  const [view, setView] = useState<ViewMode>("queue");
  const [filter, setFilter] = useState<QueueFilter>("attention");
  const [orders, setOrders] = useState<Order[]>([]);
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
      const res = await apiRequest<ListResponse>(`/api/admin/orders?status=all`, {
        auth: true,
      });
      setOrders(res.data);
      return;
    }
    const res = await apiRequest<ListResponse>(
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

  useEffect(() => {
    if (!ready) return;
    if (!isAdmin) {
      router.replace("/account");
      return;
    }
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load");
    });
    void loadPantry().catch(() => undefined);
    void loadPatrons().catch(() => undefined);
    void loadReport().catch(() => undefined);
  }, [ready, isAdmin, load, loadPantry, loadPatrons, loadReport, router]);

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
      setError(err instanceof Error ? err.message : "Could not save pantry settings");
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

  async function downloadCsv() {
    try {
      const relai = getRelai();
      await relai.auth.refresh();
      const token = relai.auth.accessToken;
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`${API_BASE_URL}/api/admin/pantry/report.csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("CSV download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pantry-report.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV download failed");
    }
  }

  useEffect(() => {
    if (pantryMode && section === "escrow") setSection("patrons");
  }, [pantryMode, section]);

  if (!ready || !isAdmin) {
    return (
      <div className="rounded-2xl bg-white p-6 text-zinc-600 shadow-sm">
        Checking admin access…
      </div>
    );
  }

  const filters: QueueFilter[] = [
    "attention",
    "disputed",
    "stuck",
    "frozen",
    "overdue",
  ];

  const sections: { id: AdminSection; label: string }[] = [
    { id: "patrons", label: "Patrons" },
    { id: "settings", label: "Settings" },
    { id: "report", label: "Report" },
    ...(pantryMode ? [] : [{ id: "escrow" as const, label: "Escrow" }]),
  ];

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
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {pantryMode
            ? "Patron directory, pantry settings, and reporting. No payments or escrow in pantry mode."
            : "See who is on the platform, manage settings, and resolve escrow."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                section === s.id
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {s.label}
              {s.id === "patrons" && patrons.length > 0
                ? ` · ${patrons.length}`
                : ""}
            </button>
          ))}
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}
      </div>

      {section === "settings" ? (
        <>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">
              {pantryMode ? "Pilot runbook" : "Ops runbook"}
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
              {(pantryMode ? PILOT_RUNBOOK : MARKETPLACE_RUNBOOK).map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Pantry mode</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Free food handoffs with baskets and inventory holds. No Stripe,
              escrow, payouts, or disputes while this is on.
            </p>
            <label className="mt-4 flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={pantryEnabled}
                onChange={e => setPantryEnabled(e.target.checked)}
              />
              Enable pantry mode
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="font-semibold text-zinc-800">
                  Default patron cap
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={defaultCap}
                  onChange={e => setDefaultCap(Number(e.target.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="font-semibold text-zinc-800">
                  Basket hold TTL (min)
                </span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={basketTtl}
                  onChange={e => setBasketTtl(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  0 = never auto-clear idle baskets
                </span>
              </label>
              <label className="text-sm">
                <span className="font-semibold text-zinc-800">Low-stock at ≤</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={lowStock}
                  onChange={e => setLowStock(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pantryBusy}
              onClick={() => void savePantry()}
              className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pantryBusy ? "Saving…" : "Save pantry settings"}
            </button>
          </div>
        </>
      ) : null}

      {section === "report" ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Pantry report</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadReport()}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void downloadCsv()}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Download CSV
              </button>
            </div>
          </div>
          {report ? (
            <>
              <p className="mt-2 text-xs text-zinc-500">
                As of {new Date(report.generatedAt).toLocaleString()}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(
                  [
                    ["Units out", report.summary.unitsOut],
                    ["No-shows", report.summary.noShows],
                    ["Stock-outs", report.summary.stockOuts],
                    ["Low stock", report.summary.lowStock],
                    ["Open orders", report.summary.openOrders],
                    ["Overdue drop-offs", report.summary.overdueDropOffs],
                    ["Active baskets", report.summary.activeBaskets],
                    ["Reserved units", report.summary.reservedUnits],
                    ["Completed", report.summary.completedOrders],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-zinc-50 px-3 py-3">
                    <p className="text-xs font-medium text-zinc-500">{label}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-600">Loading report…</p>
          )}
        </div>
      ) : null}

      {section === "patrons" ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Patron accounts</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Everyone with Neighbor or Pantry role — {patrons.length} account
                {patrons.length === 1 ? "" : "s"} on the platform.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPatrons()}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
            >
              Refresh
            </button>
          </div>
          <input
            type="search"
            placeholder="Search name, email, role…"
            value={patronQuery}
            onChange={e => setPatronQuery(e.target.value)}
            className="mt-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          {filteredPatrons.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">
              {patrons.length === 0
                ? "No patron accounts yet."
                : "No accounts match that search."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-100">
              {filteredPatrons.map(p => (
                <li
                  key={p.userId}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {p.name ?? p.email ?? p.userId}
                      {p.pantryBlocked ? (
                        <span className="ml-2 text-xs font-semibold text-red-700">
                          Blocked
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-zinc-600">
                      {p.email ?? "No email"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Roles: {p.roles.join(", ") || "none"}
                      {p.isPantrySeller ? " · pantry" : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Cap {p.allocation?.used ?? 0}/{p.allocation?.cap ?? "—"}
                      {" · "}
                      Orders {p.activity?.completedAsBuyer ?? 0} completed
                      {(p.activity?.openAsBuyer ?? 0) > 0
                        ? ` · ${p.activity?.openAsBuyer} open`
                        : ""}
                      {(p.activity?.ordersAsSeller ?? 0) > 0
                        ? ` · ${p.activity?.ordersAsSeller} as pantry`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Joined{" "}
                      {p.createdAt
                        ? new Date(p.createdAt).toLocaleDateString()
                        : "—"}
                      {p.activity?.lastOrderAt
                        ? ` · last order ${new Date(
                            p.activity.lastOrderAt,
                          ).toLocaleDateString()}`
                        : " · no orders yet"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      placeholder="cap"
                      value={capDrafts[p.userId] ?? ""}
                      onChange={e =>
                        setCapDrafts(d => ({
                          ...d,
                          [p.userId]: e.target.value,
                        }))
                      }
                      className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={busyId === p.userId}
                      onClick={() => {
                        const raw = (capDrafts[p.userId] ?? "").trim();
                        const patronCap =
                          raw === ""
                            ? null
                            : Math.max(
                                1,
                                Math.min(50, Number.parseInt(raw, 10) || 1),
                              );
                        void savePatron(p.userId, { patronCap });
                      }}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Save cap
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.userId}
                      onClick={() =>
                        void savePatron(p.userId, {
                          pantryBlocked: !p.pantryBlocked,
                        })
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      {p.pantryBlocked ? "Unblock" : "Block"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {section === "escrow" ? (
        <>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setView("queue")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  view === "queue"
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                Escrow queue
              </button>
              <button
                type="button"
                onClick={() => setView("all")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  view === "all"
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                All orders
              </button>
              {view === "queue"
                ? filters.map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${
                        filter === f
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {f}
                    </button>
                  ))
                : null}
              {view === "queue" ? (
                <button
                  type="button"
                  disabled={busyId === "sweeps"}
                  onClick={() => void runSweeps()}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Run sweeps
                </button>
              ) : null}
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm">
              {view === "all" ? "No orders yet." : "No orders in this queue."}
            </div>
          ) : (
            orders.map(order => (
              <div key={order.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <p className="font-semibold">
                  {order.listing?.title ?? order.listingId}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-500">{order.id}</p>
                <ul className="mt-3 space-y-1 text-sm text-zinc-700">
                  <li>
                    Status: {order.status}
                    {order.completedReason ? ` (${order.completedReason})` : ""}
                    {order.cancelledReason ? ` / ${order.cancelledReason}` : ""}
                  </li>
                  <li>Payment: {order.paymentStatus ?? "—"}</li>
                  <li>
                    Neighbor: {order.buyerUserId} · Pantry:{" "}
                    {order.sellerUserId}
                  </li>
                  <li>Created: {new Date(order.createdAt).toLocaleString()}</li>
                  <li>
                    Dispute: {order.disputeStatus ?? "—"}
                    {order.stripeDisputeId ? ` (${order.stripeDisputeId})` : ""}
                  </li>
                  {order.platformDisputeOpenedAt ? (
                    <li className="text-amber-800">
                      Platform dispute by {order.platformDisputeOpenedBy}:{" "}
                      {order.platformDisputeReason}
                    </li>
                  ) : null}
                  <li>Hold: {order.adminHold ? "yes" : "no"}</li>
                  {order.transferLastError ? (
                    <li className="text-red-700">
                      Transfer error: {order.transferLastError}
                    </li>
                  ) : null}
                </ul>

                {view === "queue" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {order.paymentStatus === "disputed" ||
                    order.stripeDisputeId ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() =>
                            void run(
                              order.id,
                              `/api/admin/orders/${order.id}/dispute/resolve`,
                              { action: "refund" },
                            )
                          }
                          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Dispute → refund neighbor
                        </button>
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() =>
                            void run(
                              order.id,
                              `/api/admin/orders/${order.id}/dispute/resolve`,
                              { action: "release" },
                            )
                          }
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          Dispute → release pantry
                        </button>
                        <button
                          type="button"
                          disabled={busyId === order.id}
                          onClick={() =>
                            void run(
                              order.id,
                              `/api/admin/orders/${order.id}/dispute/resolve`,
                              { action: "clear" },
                            )
                          }
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          Clear hold
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/force-release`,
                          { overrideDispute: false },
                        )
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Force release
                    </button>
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/force-refund`,
                        )
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Force refund
                    </button>
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() =>
                        void run(
                          order.id,
                          `/api/admin/orders/${order.id}/retry-transfer`,
                        )
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Retry transfer
                    </button>
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() =>
                        void run(order.id, `/api/admin/orders/${order.id}/hold`, {
                          hold: !order.adminHold,
                        })
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {order.adminHold ? "Unfreeze" : "Freeze"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}
