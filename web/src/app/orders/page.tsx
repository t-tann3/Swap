"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import { mediaUrl } from "../../lib/media";
import type { Order } from "../../lib/types";

type StatusBucket = "placed" | "accepted" | "ready_for_pickup" | "completed";

const STATUS_BUCKETS: {
  id: StatusBucket;
  label: string;
  emptyBuying: string;
  emptySelling: string;
  statuses: Order["status"][];
}[] = [
  {
    id: "placed",
    label: "Placed",
    emptyBuying: "No placed orders waiting on a seller.",
    emptySelling: "No new orders to accept.",
    statuses: ["pending_accept"],
  },
  {
    id: "accepted",
    label: "Accepted",
    emptyBuying: "No accepted orders yet.",
    emptySelling: "No accepted orders waiting for drop-off.",
    statuses: ["accepted"],
  },
  {
    id: "ready_for_pickup",
    label: "Ready for Pickup",
    emptyBuying: "Nothing ready for pickup.",
    emptySelling: "No orders waiting on buyer pickup.",
    statuses: ["ready_for_pickup"],
  },
  {
    id: "completed",
    label: "Completed",
    emptyBuying: "No completed orders yet.",
    emptySelling: "No completed sales yet.",
    statuses: ["completed"],
  },
];

function statusLabel(order: Order): string {
  switch (order.status) {
    case "pending_accept":
      return "Waiting for seller";
    case "accepted":
      return "Accepted — drop-off needed";
    case "ready_for_pickup":
      return "Ready for pickup";
    case "completed":
      return order.completedReason === "no_show"
        ? "Completed — buyer no-show (paid to seller)"
        : "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

export default function OrdersPage() {
  const {
    ordersAsBuyer,
    ordersAsSeller,
    profile,
    acceptOrder,
    cancelOrder,
    refundOrder,
    showPrices,
    paymentsEnabled,
  } = useMarketplace();
  const isBuyer = profile?.roles.includes("buyer") ?? false;
  const isSellerRole = profile?.roles.includes("seller") ?? false;
  const showRoleTabs = isBuyer && isSellerRole;

  const [tab, setTab] = useState<"buying" | "selling">(
    isSellerRole && !isBuyer ? "selling" : "buying",
  );
  const [statusBucket, setStatusBucket] = useState<StatusBucket>("placed");
  const [error, setError] = useState<string | null>(null);

  const roleTab: "buying" | "selling" = showRoleTabs
    ? tab
    : isSellerRole && !isBuyer
      ? "selling"
      : "buying";

  const activeBucket =
    STATUS_BUCKETS.find(b => b.id === statusBucket) ?? STATUS_BUCKETS[0]!;

  const roleOrders = roleTab === "selling" ? ordersAsSeller : ordersAsBuyer;
  const data = useMemo(
    () =>
      roleOrders.filter(o => activeBucket.statuses.includes(o.status)),
    [roleOrders, activeBucket],
  );

  async function onAccept(order: Order) {
    setError(null);
    try {
      await acceptOrder(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept");
    }
  }

  async function onCancel(order: Order) {
    setError(null);
    try {
      await cancelOrder(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  async function onRefund(order: Order) {
    setError(null);
    const ok = window.confirm(
      paymentsEnabled
        ? "Cancel & refund? This voids or refunds the buyer’s escrow hold and cancels the order."
        : "Cancel this order after drop-off?",
    );
    if (!ok) return;
    try {
      await refundOrder(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refund");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Orders</h1>
      {showRoleTabs ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("buying")}
            className={`flex-1 rounded-xl py-2.5 font-semibold ${
              roleTab === "buying" ? "bg-zinc-900 text-white" : "bg-white"
            }`}
          >
            Buying
          </button>
          <button
            type="button"
            onClick={() => setTab("selling")}
            className={`flex-1 rounded-xl py-2.5 font-semibold ${
              roleTab === "selling" ? "bg-zinc-900 text-white" : "bg-white"
            }`}
          >
            Selling
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex gap-1.5">
        {STATUS_BUCKETS.map(bucket => {
          const count = roleOrders.filter(o =>
            bucket.statuses.includes(o.status),
          ).length;
          const on = statusBucket === bucket.id;
          return (
            <button
              key={bucket.id}
              type="button"
              onClick={() => setStatusBucket(bucket.id)}
              className={`flex-1 rounded-full border px-2 py-2 text-center text-xs font-semibold ${
                on
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-500"
              }`}
            >
              {bucket.label}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 space-y-3">
        {data.map(item => {
          const isSeller = roleTab === "selling";
          return (
            <div key={item.id} className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold">
                {item.listing?.title ?? "Listing"}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {showPrices
                  ? `$${(item.priceCents / 100).toFixed(2)} · `
                  : ""}
                {statusLabel(item)}
              </p>
              {item.exchangeZoneName ? (
                <p className="mt-1 text-sm text-zinc-500">
                  Exchange Zone: {item.exchangeZoneName}
                  {item.exchangeZoneAddress
                    ? ` · ${item.exchangeZoneAddress}`
                    : ""}
                </p>
              ) : null}
              {item.status === "ready_for_pickup" && item.pickupLinkExpiresAt ? (
                <p className="mt-1 text-sm text-zinc-500">
                  Pick up by{" "}
                  {new Date(item.pickupLinkExpiresAt).toLocaleString()}
                  {showPrices
                    ? " — after that, escrow releases to the seller"
                    : ""}
                </p>
              ) : null}
              {item.status === "ready_for_pickup" && item.pickupLinkCode ? (
                <div className="mt-3 rounded-lg bg-zinc-100 p-3">
                  <p className="text-[11px] font-bold uppercase text-zinc-500">
                    Pickup link
                  </p>
                  <p className="mt-1 break-all font-mono text-xs font-semibold">
                    {item.pickupLinkCode}
                  </p>
                </div>
              ) : null}
              {item.dropOffPhotoUrl &&
              (item.status === "ready_for_pickup" ||
                item.status === "completed") ? (
                <div className="mt-3">
                  <p className="text-[11px] font-bold uppercase text-zinc-500">
                    Compartment photo
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(item.dropOffPhotoUrl)!}
                    alt="Item in compartment"
                    className="mt-2 h-40 w-full rounded-lg object-cover"
                  />
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {isSeller && item.status === "pending_accept" ? (
                  <button
                    type="button"
                    onClick={() => void onAccept(item)}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Accept order
                  </button>
                ) : null}
                {isSeller && item.status === "accepted" ? (
                  <Link
                    href={`/orders/${item.id}/drop-off`}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Drop off item
                  </Link>
                ) : null}
                {!isSeller && item.status === "ready_for_pickup" ? (
                  <Link
                    href={`/orders/${item.id}/pickup`}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Pick up item
                  </Link>
                ) : null}
                {(item.status === "pending_accept" ||
                  item.status === "accepted") && (
                  <button
                    type="button"
                    onClick={() => void onCancel(item)}
                    className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                )}
                {item.status === "ready_for_pickup" ? (
                  <button
                    type="button"
                    onClick={() => void onRefund(item)}
                    className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
                  >
                    {paymentsEnabled ? "Cancel & refund" : "Cancel order"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {data.length === 0 ? (
          <p className="text-center text-zinc-500">
            {roleTab === "selling"
              ? activeBucket.emptySelling
              : activeBucket.emptyBuying}
          </p>
        ) : null}
      </div>
    </div>
  );
}
