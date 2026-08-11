"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMarketplace } from "../../../context/MarketplaceContext";
import { apiRequest } from "../../../lib/api";
import { mediaUrl } from "../../../lib/media";
import type { Listing } from "../../../lib/types";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    profile,
    toggleFavorite,
    isFavorite,
    updateListing,
    deleteListing,
    showPrices,
    pantryMode,
  } = useMarketplace();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [basketMsg, setBasketMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editStock, setEditStock] = useState("1");
  const [editMax, setEditMax] = useState("1");
  const [savingCaps, setSavingCaps] = useState(false);

  useEffect(() => {
    void apiRequest<Listing>(`/api/listings/${params.id}`)
      .then(item => {
        setListing(item);
        setEditStock(String(item.stockQty ?? 1));
        setEditMax(String(item.maxPerOrder ?? 1));
      })
      .catch(err =>
        setError(err instanceof Error ? err.message : "Not found"),
      );
  }, [params.id]);

  if (error && !listing) {
    return <p className="text-red-600">{error}</p>;
  }
  if (!listing) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  const isSeller = profile?.userId === listing.sellerUserId;
  const canTake =
    !!profile?.roles.includes("buyer") &&
    listing.status === "available" &&
    !isSeller;
  const liked = isFavorite(listing.id);

  async function addToBasket() {
    setAdding(true);
    setBasketMsg(null);
    setError(null);
    try {
      await apiRequest("/api/me/basket/items", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ listingId: listing!.id, quantity: 1 }),
      });
      setBasketMsg("Added to basket.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to basket");
    } finally {
      setAdding(false);
    }
  }

  async function saveCaps() {
    const stock = Number.parseInt(editStock, 10);
    const max = Number.parseInt(editMax, 10);
    if (!Number.isFinite(stock) || stock < 1 || !Number.isFinite(max) || max < 1) {
      setError("Stock and max per patron must be at least 1.");
      return;
    }
    setSavingCaps(true);
    setError(null);
    try {
      const next = await updateListing(listing!.id, {
        stockQty: stock,
        maxPerOrder: max,
      });
      setListing(next);
      setBasketMsg("Stock and per-item cap saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save caps");
    } finally {
      setSavingCaps(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {mediaUrl(listing.imageUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(listing.imageUrl)!}
          alt={listing.title}
          className="mb-5 h-48 w-full rounded-2xl object-cover"
        />
      ) : (
        <div
          className="mb-5 h-48 rounded-2xl"
          style={{ backgroundColor: listing.imageColor }}
        />
      )}
      <h1 className="text-3xl font-bold">{listing.title}</h1>
      {showPrices ? (
        <p className="mt-2 text-2xl font-semibold">
          ${(listing.priceCents / 100).toFixed(2)}
        </p>
      ) : pantryMode ? (
        <p className="mt-2 text-sm font-semibold text-zinc-600">Free · pantry</p>
      ) : null}
      {pantryMode ? (
        <p className="mt-1 text-sm text-zinc-500">
          {(listing.stockQty ?? 0) <= 0 || listing.status === "out_of_stock"
            ? "Out of stock"
            : `${listing.stockQty} in stock${
                listing.maxPerOrder != null
                  ? ` · max ${listing.maxPerOrder} per patron`
                  : ""
              }`}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-bold uppercase text-indigo-800">
          {listing.category}
        </span>
        <span className="text-sm capitalize text-zinc-500">
          {listing.condition.replace("_", " ")} ·{" "}
          {listing.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-4 text-zinc-700 leading-relaxed">{listing.description}</p>
      <p className="mt-2 text-sm text-zinc-500">
        Must fit a Relai Exchange Zone compartment. All doors are the same size.
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Seller: {listing.sellerName ?? listing.sellerEmail ?? "Seller"}
      </p>

      {isSeller && pantryMode ? (
        <div className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <p className="font-semibold">Stock &amp; per-item cap</p>
          <p className="mt-1 text-sm text-zinc-600">
            Max per patron limits how many of this item one basket may hold.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Stock
              <input
                type="number"
                min={1}
                max={500}
                value={editStock}
                onChange={e => setEditStock(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 font-normal"
              />
            </label>
            <label className="block text-sm font-semibold">
              Max per patron
              <input
                type="number"
                min={1}
                max={50}
                value={editMax}
                onChange={e => setEditMax(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 font-normal"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={savingCaps}
            onClick={() => void saveCaps()}
            className="mt-3 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {savingCaps ? "Saving…" : "Save caps"}
          </button>
        </div>
      ) : null}

      {basketMsg ? (
        <p className="mt-4 text-sm text-emerald-700">{basketMsg}</p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void toggleFavorite(listing.id)}
          className="rounded-xl bg-white py-3 font-semibold ring-1 ring-zinc-200"
        >
          {liked ? "Remove favorite" : "Save to favorites"}
        </button>
        {canTake && pantryMode ? (
          <>
            <button
              type="button"
              disabled={adding}
              onClick={() => void addToBasket()}
              className="rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add to basket"}
            </button>
            <Link
              href="/basket"
              className="rounded-xl bg-white py-3 text-center font-semibold ring-1 ring-zinc-200"
            >
              View basket
            </Link>
          </>
        ) : null}
        {canTake && !pantryMode ? (
          <Link
            href={`/checkout/${listing.id}`}
            className="rounded-xl bg-zinc-900 py-3 text-center font-semibold text-white"
          >
            Buy
          </Link>
        ) : null}
        {isSeller ? (
          <button
            type="button"
            className="rounded-xl bg-red-700 py-3 font-semibold text-white"
            onClick={() => {
              if (!confirm("Delete this listing?")) return;
              void deleteListing(listing.id).then(() => router.push("/sell"));
            }}
          >
            Delete listing
          </button>
        ) : null}
      </div>
    </div>
  );
}
