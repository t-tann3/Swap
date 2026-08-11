"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import { mediaUrl } from "../../lib/media";
import type { Listing } from "../../lib/types";

type InventoryRow = {
  listing: Listing;
  available: number;
  reserved: number;
  total: number;
  lowStock: boolean;
  outOfStock: boolean;
};

export default function InventoryPage() {
  const { profile, pantryMode, ready } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiRequest<{
      lowStockThreshold: number;
      data: InventoryRow[];
    }>("/api/me/inventory", { auth: true });
    setThreshold(res.lowStockThreshold);
    setRows(res.data);
  }, []);

  useEffect(() => {
    if (!ready || !isSeller || !pantryMode) return;
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load inventory");
    });
  }, [ready, isSeller, pantryMode, load]);

  async function adjust(listingId: string, delta: number) {
    setBusyId(listingId);
    setError(null);
    try {
      await apiRequest(`/api/listings/${listingId}/stock-adjust`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ delta }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not adjust stock");
    } finally {
      setBusyId(null);
    }
  }

  if (!isSeller) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Seller role required</h1>
      </div>
    );
  }

  if (!pantryMode) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Inventory</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Inventory lite is available when pantry mode is on.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Inventory</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Available is free stock. Reserved is held in patron baskets.
              Low-stock flag at ≤ {threshold}.
            </p>
          </div>
          <Link
            href="/sell"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
          >
            Post item
          </Link>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm">
          No pantry listings yet. Post food from Sell.
        </div>
      ) : (
        rows.map(row => (
          <div
            key={row.listing.id}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 gap-3">
                {mediaUrl(row.listing.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(row.listing.imageUrl)!}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    className="h-16 w-16 shrink-0 rounded-lg"
                    style={{ backgroundColor: row.listing.imageColor }}
                  />
                )}
                <div className="min-w-0">
                  <Link
                    href={`/listing/${row.listing.id}`}
                    className="font-semibold hover:underline"
                  >
                    {row.listing.title}
                  </Link>
                  <p className="mt-1 text-xs text-zinc-500">
                    {row.outOfStock
                      ? "Out of stock"
                      : row.lowStock
                        ? "Low stock"
                        : "In stock"}{" "}
                    · max/order {row.listing.maxPerOrder ?? 1}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <div>
                  <p className="text-xs text-zinc-500">Available</p>
                  <p className="font-bold tabular-nums">{row.available}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Reserved</p>
                  <p className="font-bold tabular-nums">{row.reserved}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Total</p>
                  <p className="font-bold tabular-nums">{row.total}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === row.listing.id}
                onClick={() => void adjust(row.listing.id, -1)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                −1
              </button>
              <button
                type="button"
                disabled={busyId === row.listing.id}
                onClick={() => void adjust(row.listing.id, 1)}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                +1
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
