"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useMarketplace } from "../../../context/MarketplaceContext";
import { apiRequest } from "../../../lib/api";
import { mediaUrl } from "../../../lib/media";
import type { Order } from "../../../lib/types";

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
      return null;
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
  const email = order.buyerEmail?.trim() || "Unknown";
  return `${email}'s Order Basket`;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const {
    profile,
    acceptOrder,
    cancelOrder,
    disputeOrder,
    showPrices,
    pantryMode,
    refresh,
  } = useMarketplace();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await apiRequest<Order>(`/api/orders/${params.id}`, {
        auth: true,
      });
      setOrder(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order not found");
      setOrder(null);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isSeller = Boolean(order && profile?.userId === order.sellerUserId);

  function canDispute(o: Order): boolean {
    if (pantryMode || o.priceCents === 0) return false;
    if (o.platformDisputeOpenedAt || o.paymentStatus === "disputed") {
      return false;
    }
    return (
      o.status === "accepted" ||
      o.status === "ready_for_pickup" ||
      o.status === "completed"
    );
  }

  async function onAccept() {
    if (!order) return;
    setError(null);
    try {
      await acceptOrder(order.id);
      await refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept");
    }
  }

  async function onCancel() {
    if (!order) return;
    setError(null);
    try {
      await cancelOrder(order.id);
      await refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  async function onDispute() {
    if (!order) return;
    setError(null);
    if (disputeReason.trim().length < 8) {
      setError("Describe the issue in at least 8 characters.");
      return;
    }
    try {
      await disputeOrder(order.id, disputeReason.trim());
      setDisputeOpen(false);
      setDisputeReason("");
      await refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open dispute");
    }
  }

  if (!order && !error) {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (!order) {
    return (
      <div>
        <Link href="/orders" className="text-sm font-semibold text-blue-600">
          ← Orders
        </Link>
        <p className="mt-4 text-red-600">{error}</p>
      </div>
    );
  }

  const label = statusLabel(order);

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/orders" className="text-sm font-semibold text-blue-600">
        ← Orders
      </Link>

      <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{orderTitle(order)}</h1>
        <p className="mt-2 text-sm font-semibold text-zinc-600 select-all">
          Order ID: {order.id}
        </p>

        {orderLines(order).length > 1 ? (
          <ul className="mt-3 space-y-1 text-sm text-zinc-600">
            {orderLines(order).map(line => (
              <li key={line.listingId}>
                {line.quantity}× {line.listing?.title ?? line.title}
              </li>
            ))}
          </ul>
        ) : null}

        {showPrices || label || (isSeller && isDropOffOverdue(order)) ? (
          <p className="mt-2 text-sm text-zinc-500">
            {showPrices
              ? `$${(order.priceCents / 100).toFixed(2)}${label ? " · " : ""}`
              : ""}
            {label ?? ""}
            {isSeller && isDropOffOverdue(order) ? (
              <span className="ml-2 font-semibold text-amber-800">Overdue</span>
            ) : null}
          </p>
        ) : null}

        {order.exchangeZoneName ? (
          <p className="mt-2 text-sm text-zinc-500">
            Exchange Zone: {order.exchangeZoneName}
            {order.exchangeZoneAddress
              ? ` · ${order.exchangeZoneAddress}`
              : ""}
          </p>
        ) : null}

        {isSeller ? (
          <p className="mt-1 text-sm text-zinc-500">
            Patron: {order.buyerEmail?.trim() || "Unknown"}
          </p>
        ) : null}

        {order.status === "completed" &&
        order.completedReason !== "no_show" &&
        (order.relaiPickupVerifiedAt || order.completedAt) ? (
          <p className="mt-1 text-sm text-zinc-500">
            Picked Up:{" "}
            {new Date(
              order.relaiPickupVerifiedAt ?? order.completedAt!,
            ).toLocaleString(undefined, {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        ) : null}

        {order.status === "ready_for_pickup" && order.pickupLinkExpiresAt ? (
          <p className="mt-2 text-sm text-zinc-500">
            Pick up by{" "}
            {new Date(order.pickupLinkExpiresAt).toLocaleString(undefined, {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {showPrices && order.priceCents > 0
              ? " — after that, escrow releases to the seller"
              : pantryMode || order.priceCents === 0
                ? " — after that the order may close as a no-show"
                : ""}
          </p>
        ) : null}

        {order.dropOffPhotoUrl &&
        (order.status === "ready_for_pickup" ||
          order.status === "completed") ? (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase text-zinc-500">
              Compartment photo
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(order.dropOffPhotoUrl)!}
              alt="Item in compartment"
              className="mt-2 h-48 w-full rounded-lg object-cover"
            />
          </div>
        ) : null}

        {(order.platformDisputeOpenedAt ||
          order.paymentStatus === "disputed") &&
        order.priceCents > 0 &&
        !pantryMode ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dispute open
            {order.platformDisputeReason
              ? `: ${order.platformDisputeReason}`
              : order.disputeStatus
                ? ` (Stripe: ${order.disputeStatus})`
                : ""}
            . Escrow is frozen until ops review.
          </p>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {isSeller && order.status === "pending_accept" ? (
            <button
              type="button"
              onClick={() => void onAccept()}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
            >
              Accept order
            </button>
          ) : null}
          {isSeller && order.status === "accepted" ? (
            <Link
              href={`/orders/${order.id}/drop-off`}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
            >
              {order.priceCents === 0 ? "Drop off basket" : "Drop off item"}
            </Link>
          ) : null}
          {!isSeller && order.status === "ready_for_pickup" ? (
            <Link
              href={`/orders/${order.id}/pickup`}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
            >
              {order.priceCents === 0 ? "Pick up basket" : "Pick up item"}
            </Link>
          ) : null}
          {(order.status === "pending_accept" ||
            order.status === "accepted") && (
            <button
              type="button"
              onClick={() => void onCancel()}
              className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
          )}
          {canDispute(order) ? (
            <button
              type="button"
              onClick={() => {
                setDisputeOpen(true);
                setDisputeReason("");
              }}
              className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
            >
              Open dispute
            </button>
          ) : null}
        </div>

        {disputeOpen ? (
          <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3">
            <p className="text-sm text-zinc-600">
              After drop-off, the item may already be in a locker. Describe the
              issue — ops will refund or release after review.
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
                onClick={() => void onDispute()}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Submit dispute
              </button>
              <button
                type="button"
                onClick={() => setDisputeOpen(false)}
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
              >
                Back
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
