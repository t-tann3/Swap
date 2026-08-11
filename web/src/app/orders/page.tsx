"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import { mediaUrl } from "../../lib/media";
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

function statusLabel(order: Order): string {
  const pantryOrder = order.priceCents === 0;
  switch (order.status) {
    case "pending_accept":
      return pantryOrder ? "Placed — waiting for pantry" : "Waiting for seller";
    case "accepted":
      return pantryOrder
        ? "Accepted — pantry drop-off needed"
        : "Accepted — drop-off needed";
    case "ready_for_pickup":
      return "Ready for pickup";
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

function orderLines(order: Order) {
  if (order.items && order.items.length > 0) return order.items;
  return [
    {
      listingId: order.listingId,
      quantity: 1,
      title: order.listing?.title ?? "Listing",
      listing: order.listing,
    },
  ];
}

function orderTitle(order: Order): string {
  const lines = orderLines(order);
  if (lines.length === 1) {
    return lines[0]!.listing?.title ?? lines[0]!.title ?? "Listing";
  }
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  return `Basket · ${lines.length} items (${units} units)`;
}

export default function OrdersPage() {
  const {
    ordersAsBuyer,
    ordersAsSeller,
    profile,
    acceptOrder,
    cancelOrder,
    disputeOrder,
    showPrices,
    pantryMode,
  } = useMarketplace();
  const isBuyer = profile?.roles.includes("buyer") ?? false;
  const isSellerRole = profile?.roles.includes("seller") ?? false;
  const showRoleTabs = isBuyer && isSellerRole;

  const [tab, setTab] = useState<"buying" | "selling">(
    isSellerRole && !isBuyer ? "selling" : "buying",
  );
  const [statusBucket, setStatusBucket] = useState<StatusBucket>("placed");
  const [error, setError] = useState<string | null>(null);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

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

  async function onDispute(order: Order) {
    setError(null);
    if (disputeReason.trim().length < 8) {
      setError("Describe the issue in at least 8 characters.");
      return;
    }
    try {
      await disputeOrder(order.id, disputeReason.trim());
      setDisputeFor(null);
      setDisputeReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open dispute");
    }
  }

  function canDispute(order: Order): boolean {
    if (pantryMode || order.priceCents === 0) return false;
    if (order.platformDisputeOpenedAt || order.paymentStatus === "disputed") {
      return false;
    }
    return (
      order.status === "accepted" ||
      order.status === "ready_for_pickup" ||
      order.status === "completed"
    );
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

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 space-y-3">
        {data.map(item => {
          const isSeller = roleTab === "selling";
          return (
            <div key={item.id} className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold">{orderTitle(item)}</h2>
              {orderLines(item).length > 1 ? (
                <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                  {orderLines(item).map(line => (
                    <li key={line.listingId}>
                      {line.quantity}× {line.listing?.title ?? line.title}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-sm text-zinc-500">
                {showPrices
                  ? `$${(item.priceCents / 100).toFixed(2)} · `
                  : ""}
                {statusLabel(item)}
                {isSeller && isDropOffOverdue(item) ? (
                  <span className="ml-2 font-semibold text-amber-800">
                    Overdue
                  </span>
                ) : null}
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
                  {showPrices && item.priceCents > 0
                    ? " — after that, escrow releases to the seller"
                    : pantryMode || item.priceCents === 0
                      ? " — after that the order may close as a no-show"
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
              {(item.platformDisputeOpenedAt ||
                item.paymentStatus === "disputed") &&
              item.priceCents > 0 &&
              !pantryMode ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Dispute open
                  {item.platformDisputeReason
                    ? `: ${item.platformDisputeReason}`
                    : item.disputeStatus
                      ? ` (Stripe: ${item.disputeStatus})`
                      : ""}
                  . Escrow is frozen until ops review.
                </p>
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
                    {item.priceCents === 0
                      ? "Drop off basket"
                      : "Drop off item"}
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
                {canDispute(item) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDisputeFor(item.id);
                      setDisputeReason("");
                    }}
                    className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
                  >
                    Open dispute
                  </button>
                ) : null}
              </div>
              {disputeFor === item.id ? (
                <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm text-zinc-600">
                    After drop-off, the item may already be in a locker. Describe
                    the issue — ops will refund or release after review.
                  </p>
                  <textarea
                    value={disputeReason}
                    onChange={e => setDisputeReason(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    placeholder="What went wrong?"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onDispute(item)}
                      className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Submit dispute
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeFor(null)}
                      className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : null}
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
