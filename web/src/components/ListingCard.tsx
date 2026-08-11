"use client";

import Link from "next/link";

import { useMarketplace } from "../context/MarketplaceContext";
import { mediaUrl } from "../lib/media";
import type { Listing } from "../lib/types";

export function ListingCard({
  item,
  href,
}: {
  item: Listing;
  href: string;
}) {
  const { showPrices, pantryMode } = useMarketplace();
  const photo = mediaUrl(item.imageUrl);

  return (
    <Link
      href={href}
      className="flex gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-zinc-100 transition hover:ring-zinc-300"
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div
          className="h-16 w-16 shrink-0 rounded-lg"
          style={{ backgroundColor: item.imageColor }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold">{item.title}</h3>
          {showPrices ? (
            <span className="shrink-0 font-bold">
              ${(item.priceCents / 100).toFixed(2)}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-800">
            {item.category}
          </span>
          <span className="text-xs text-zinc-500 capitalize">
            {item.condition.replace("_", " ")}
          </span>
        </div>
        {pantryMode ? (
          <p className="mt-1 text-xs text-zinc-500">
            {item.status === "out_of_stock" || (item.stockQty ?? 0) <= 0
              ? "Out of stock"
              : `Stock ${item.stockQty ?? 1} · max ${item.maxPerOrder ?? 1}/patron`}
          </p>
        ) : item.status !== "available" ? (
          <p className="mt-1 text-xs capitalize text-zinc-500">
            {item.status.replace(/_/g, " ")}
          </p>
        ) : null}
        <p className="mt-1 line-clamp-2 text-sm text-zinc-600">
          {item.description}
        </p>
      </div>
    </Link>
  );
}
