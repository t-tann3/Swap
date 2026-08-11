"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import type { Order } from "../../lib/types";

type Filter = "attention" | "stuck" | "disputed" | "frozen" | "overdue";

type EscrowListResponse = {
  filter: string;
  count: number;
  data: Order[];
};

export default function AdminPage() {
  const { profile, ready } = useMarketplace();
  const router = useRouter();
  const isAdmin = profile?.roles.includes("admin") ?? false;
  const [filter, setFilter] = useState<Filter>("attention");
  const [orders, setOrders] = useState<Order[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiRequest<EscrowListResponse>(
      `/api/admin/orders/escrow?filter=${filter}`,
      { auth: true },
    );
    setOrders(res.data);
  }, [filter]);

  useEffect(() => {
    if (!ready) return;
    if (!isAdmin) {
      router.replace("/account");
      return;
    }
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load");
    });
  }, [ready, isAdmin, load, router]);

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
      setMessage("Sweeps finished.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sweep failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready || !isAdmin) {
    return (
      <div className="rounded-2xl bg-white p-6 text-zinc-600 shadow-sm">
        Checking admin access…
      </div>
    );
  }

  const filters: Filter[] = [
    "attention",
    "disputed",
    "stuck",
    "frozen",
    "overdue",
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Resolve disputes and approve escrow actions. This role is separate from
          buyer and seller.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map(f => (
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
          ))}
          <button
            type="button"
            disabled={busyId === "sweeps"}
            onClick={() => void runSweeps()}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Run sweeps
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm">
          No orders in this queue.
        </div>
      ) : (
        orders.map(order => (
          <div
            key={order.id}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
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
                Dispute: {order.disputeStatus ?? "—"}
                {order.stripeDisputeId ? ` (${order.stripeDisputeId})` : ""}
              </li>
              <li>Hold: {order.adminHold ? "yes" : "no"}</li>
              {order.transferLastError ? (
                <li className="text-red-700">
                  Transfer error: {order.transferLastError}
                </li>
              ) : null}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              {order.paymentStatus === "disputed" || order.stripeDisputeId ? (
                <>
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() =>
                      void run(order.id, `/api/admin/orders/${order.id}/dispute/resolve`, {
                        action: "refund",
                      })
                    }
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Dispute → refund buyer
                  </button>
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() =>
                      void run(order.id, `/api/admin/orders/${order.id}/dispute/resolve`, {
                        action: "release",
                      })
                    }
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    Dispute → release seller
                  </button>
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() =>
                      void run(order.id, `/api/admin/orders/${order.id}/dispute/resolve`, {
                        action: "clear",
                      })
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
                  void run(order.id, `/api/admin/orders/${order.id}/force-release`, {
                    overrideDispute: false,
                  })
                }
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Force release
              </button>
              <button
                type="button"
                disabled={busyId === order.id}
                onClick={() =>
                  void run(order.id, `/api/admin/orders/${order.id}/force-refund`)
                }
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Force refund
              </button>
              <button
                type="button"
                disabled={busyId === order.id}
                onClick={() =>
                  void run(order.id, `/api/admin/orders/${order.id}/retry-transfer`)
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
          </div>
        ))
      )}
    </div>
  );
}
