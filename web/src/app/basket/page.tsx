"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import type { Listing } from "../../lib/types";
import { getRelai } from "../../lib/relai/client";

type BasketItem = {
  listingId: string;
  quantity: number;
  listing: Listing | null;
  maxPerOrder?: number;
  basketLimit?: number;
};

export default function BasketPage() {
  const { pantryMode, refresh } = useMarketplace();
  const [items, setItems] = useState<BasketItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zones, setZones] = useState<
    { id: string; name: string; address: string | null }[]
  >([]);
  const [zoneId, setZoneId] = useState("");

  const load = useCallback(async () => {
    const res = await apiRequest<{
      basket: { items: BasketItem[] };
    }>("/api/me/basket", { auth: true });
    setItems(res.basket.items);
  }, []);

  useEffect(() => {
    if (!pantryMode) return;
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load basket");
    });
    void (async () => {
      try {
        const ezList = await getRelai().exchangeZones.list({ limit: 50 });
        const mapped = ezList.map(z => ({
          id: z.id,
          name: z.name,
          address: z.address ?? null,
        }));
        setZones(mapped);
        const first = ezList.find(z => z.is_open_now && z.nodes_available > 0);
        if (first) setZoneId(first.id);
        else if (mapped[0]) setZoneId(mapped[0].id);
      } catch {
        // ignore
      }
    })();
  }, [pantryMode, load]);

  if (!pantryMode) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Basket</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Pantry mode is off. Baskets and item caps are only used when an admin
          enables pantry mode.
        </p>
      </div>
    );
  }

  async function setQty(listingId: string, quantity: number) {
    setError(null);
    try {
      const res = await apiRequest<{
        basket: { items: BasketItem[] };
      }>(`/api/me/basket/items/${listingId}`, {
        method: "PATCH",
        auth: true,
        body: JSON.stringify({ quantity }),
      });
      setItems(res.basket.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    }
  }

  async function checkout() {
    if (!zoneId) {
      setError("Choose an Exchange Zone.");
      return;
    }
    const zone = zones.find(z => z.id === zoneId);
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/me/basket/checkout", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          exchangeZoneId: zoneId,
          exchangeZoneName: zone?.name ?? "Exchange Zone",
          exchangeZoneAddress: zone?.address ?? null,
        }),
      });
      await refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Basket</h1>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {items.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm">
          Your basket is empty.{" "}
          <Link href="/browse" className="font-semibold underline">
            Browse food
          </Link>
        </div>
      ) : (
        items.map(item => (
          <div
            key={item.listingId}
            className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm"
          >
            <div>
              <p className="font-semibold">
                {item.listing?.title ?? item.listingId}
              </p>
              <p className="text-sm text-zinc-500">
                Qty {item.quantity}
                {item.maxPerOrder != null
                  ? ` · max ${item.maxPerOrder} of this item`
                  : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold"
                onClick={() => void setQty(item.listingId, item.quantity - 1)}
              >
                −
              </button>
              <button
                type="button"
                disabled={
                  item.quantity >=
                  (item.basketLimit ?? item.maxPerOrder ?? Infinity)
                }
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                onClick={() => void setQty(item.listingId, item.quantity + 1)}
              >
                +
              </button>
            </div>
          </div>
        ))
      )}

      {items.length > 0 ? (
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <label className="block text-sm font-semibold">
            Pickup Exchange Zone
            <select
              className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2"
              value={zoneId}
              onChange={e => setZoneId(e.target.value)}
            >
              {zones.map(z => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void checkout()}
            className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Reserving…" : "Reserve for pickup (free)"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
