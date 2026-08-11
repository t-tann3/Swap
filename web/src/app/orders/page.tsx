"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import type { Order } from "../../lib/types";

type StatusBucket =
  | "placed"
  | "accepted"
  | "ready_for_pickup"
  | "completed";

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

function isDropOffOverdue(order: Order): boolean {
  if (order.status !== "accepted" || !order.sellerDropOffDeadlineAt) return false;
  return Date.parse(order.sellerDropOffDeadlineAt) < Date.now();
}

function statusLabel(order: Order): string | null {
  const pantryOrder = order.priceCents === 0;
  switch (order.status) {
    case "pending_accept":
      return pantryOrder ? "Placed — waiting for pantry" : "Waiting for seller";
    case "accepted":
      return pantryOrder
        ? "Accepted — pantry drop-off needed"
        : "Accepted — drop-off needed";
    case "ready_for_pickup":
      return null;
    case "completed":
      if (order.completedReason === "no_show") {
        return pantryOrder
          ? "Completed — no-show"
          : "Completed — buyer no-show (paid to seller)";
      }
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

function orderTitle(order: Order): string {
  const email = order.buyerEmail?.trim() || "Unknown";
  return `${email}'s Order Basket`;
}

export default function OrdersPage() {
  const {
    ordersAsBuyer,
    ordersAsSeller,
    profile,
    showPrices,
  } = useMarketplace();
  const isBuyer = profile?.roles.includes("buyer") ?? false;
  const isSellerRole = profile?.roles.includes("seller") ?? false;
  const showRoleTabs = isBuyer && isSellerRole;

  const [tab, setTab] = useState<"buying" | "selling">(
    isSellerRole && !isBuyer ? "selling" : "buying",
  );
  const [statusBucket, setStatusBucket] = useState<StatusBucket>("placed");

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

      <div className="mt-3 flex flex-wrap gap-1.5">
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
              className={`rounded-full border px-2.5 py-2 text-center text-xs font-semibold ${
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

      <div className="mt-5 space-y-3">
        {data.map(item => {
          const isSeller = roleTab === "selling";
          const label = statusLabel(item);
          return (
            <Link
              key={item.id}
              href={`/orders/${item.id}`}
              className="block rounded-xl bg-white p-4 shadow-sm transition hover:bg-zinc-50"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{orderTitle(item)}</h2>
                <span className="text-xl font-light text-zinc-400">›</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-zinc-600">
                Order ID: {item.id}
              </p>
              {showPrices || label || (isSeller && isDropOffOverdue(item)) ? (
                <p className="mt-1 text-sm text-zinc-500">
                  {showPrices
                    ? `$${(item.priceCents / 100).toFixed(2)}${
                        label ? " · " : ""
                      }`
                    : ""}
                  {label ?? ""}
                  {isSeller && isDropOffOverdue(item) ? (
                    <span className="ml-2 font-semibold text-amber-800">
                      Overdue
                    </span>
                  ) : null}
                </p>
              ) : null}
              {item.exchangeZoneName ? (
                <p className="mt-1 text-sm text-zinc-500">
                  Exchange Zone: {item.exchangeZoneName}
                  {item.exchangeZoneAddress
                    ? ` · ${item.exchangeZoneAddress}`
                    : ""}
                </p>
              ) : null}
            </Link>
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
