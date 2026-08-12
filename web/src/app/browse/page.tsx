"use client";

import { ListingCard } from "../../components/ListingCard";
import { useMarketplace } from "../../context/MarketplaceContext";
import { LISTING_CATEGORIES } from "../../lib/categories";

export default function BrowsePage() {
  const {
    availableListings,
    profile,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    refresh,
    refreshing,
  } = useMarketplace();

  if (!profile?.roles.includes("buyer")) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Neighbor role required</h1>
        <p className="mt-2 text-zinc-600">
          Enable Neighbor in Account to browse and pick up items.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Browse</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm font-semibold text-zinc-600"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <input
        className="mb-4 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3"
        placeholder="Search marketplace"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {["", ...LISTING_CATEGORIES].map(cat => {
          const label = cat || "All";
          const active = selectedCategory === cat;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap ${
                active
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-800 ring-1 ring-zinc-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {availableListings.map(item => (
          <ListingCard
            key={item.id}
            item={item}
            href={`/listing/${item.id}`}
          />
        ))}
      </div>

      {availableListings.length === 0 ? (
        <p className="mt-8 text-center text-zinc-500">
          No items match. Try another search or category.
        </p>
      ) : null}
    </div>
  );
}
