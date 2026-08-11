"use client";

import { ListingCard } from "../../components/ListingCard";
import { useMarketplace } from "../../context/MarketplaceContext";

export default function FavoritesPage() {
  const { favorites, profile } = useMarketplace();

  if (!profile?.roles.includes("buyer")) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Neighbor role required</h1>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Saved</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {favorites.map(item => (
          <ListingCard
            key={item.id}
            item={item}
            href={`/listing/${item.id}`}
          />
        ))}
      </div>
      {favorites.length === 0 ? (
        <p className="mt-8 text-center text-zinc-500">
          Saved items show up here.
        </p>
      ) : null}
    </div>
  );
}
