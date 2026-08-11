"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMarketplace } from "../../../context/MarketplaceContext";
import { apiRequest } from "../../../lib/api";
import { formatCompartmentSize } from "../../../lib/compartmentSizes";
import type { Listing } from "../../../lib/types";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { profile, toggleFavorite, isFavorite, deleteListing, showPrices } =
    useMarketplace();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<Listing>(`/api/listings/${params.id}`)
      .then(setListing)
      .catch(err =>
        setError(err instanceof Error ? err.message : "Not found"),
      );
  }, [params.id]);

  if (error) {
    return <p className="text-red-600">{error}</p>;
  }
  if (!listing) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  const isSeller = profile?.userId === listing.sellerUserId;
  const canBuy =
    !!profile?.roles.includes("buyer") &&
    listing.status === "available" &&
    !isSeller;
  const liked = isFavorite(listing.id);

  return (
    <div className="mx-auto max-w-2xl">
      <div
        className="mb-5 h-48 rounded-2xl"
        style={{ backgroundColor: listing.imageColor }}
      />
      <h1 className="text-3xl font-bold">{listing.title}</h1>
      {showPrices ? (
        <p className="mt-2 text-2xl font-semibold">
          ${(listing.priceCents / 100).toFixed(2)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-bold uppercase text-indigo-800">
          {listing.category}
        </span>
        <span className="rounded bg-zinc-100 px-2.5 py-1 text-xs font-bold uppercase text-zinc-700">
          {formatCompartmentSize(listing.compartmentSize)}
        </span>
        <span className="text-sm capitalize text-zinc-500">
          {listing.condition.replace("_", " ")} · {listing.status}
        </span>
      </div>
      <p className="mt-4 text-zinc-700 leading-relaxed">{listing.description}</p>
      <p className="mt-2 text-sm text-zinc-500">
        Fits a Relai Exchange Zone {listing.compartmentSize} compartment — items
        larger than a Full Tower door cannot be listed.
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Seller: {listing.sellerName ?? listing.sellerEmail ?? "Seller"}
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void toggleFavorite(listing.id)}
          className="rounded-xl bg-white py-3 font-semibold ring-1 ring-zinc-200"
        >
          {liked ? "Remove favorite" : "Save to favorites"}
        </button>
        {canBuy ? (
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
