"use client";

import { useState, type FormEvent } from "react";

import { ListingCard } from "../../components/ListingCard";
import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import {
  LISTING_CATEGORIES,
  type ListingCategory,
} from "../../lib/categories";
import { fileToBase64, mediaUrl } from "../../lib/media";

export default function SellPage() {
  const { profile, myListings, createListing, showPrices } = useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ListingCategory>("General");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!profile?.roles.includes("seller")) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Seller role required</h1>
        <p className="mt-2 text-zinc-600">
          Enable Seller in Account to post items.
        </p>
      </div>
    );
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setMessage(null);
    try {
      const { imageBase64, mimeType } = await fileToBase64(file);
      const res = await apiRequest<{ url: string }>("/api/uploads", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      setImageUrl(res.url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const dollars = showPrices ? Number.parseFloat(price) : 0;
    if (
      !title.trim() ||
      !description.trim() ||
      (showPrices && Number.isNaN(dollars))
    ) {
      setMessage(
        showPrices
          ? "Add a title, description, and valid price."
          : "Add a title and description.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await createListing({
        title,
        description,
        category,
        priceCents: Math.round(dollars * 100),
        condition: "good",
        locationLabel: "Local Exchange Zone",
        imageUrl,
      });
      setTitle("");
      setDescription("");
      setPrice("");
      setCategory("General");
      setImageUrl(null);
      setMessage("Listing posted.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not post");
    } finally {
      setBusy(false);
    }
  }

  const preview = mediaUrl(imageUrl);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={onSubmit} className="rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Post an item</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Items must fit a Relai Exchange Zone compartment. All doors are the
          same size. A listing photo is optional.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-2 text-sm font-semibold">Photo (optional)</p>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Listing preview"
                className="mb-2 h-44 w-full rounded-xl object-cover"
              />
            ) : (
              <div className="mb-2 flex h-28 items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-500">
                No photo yet
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || photoBusy}
              onChange={e => void onFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-600"
            />
            {imageUrl ? (
              <button
                type="button"
                className="mt-2 text-sm font-semibold text-zinc-600 underline"
                onClick={() => setImageUrl(null)}
              >
                Remove photo
              </button>
            ) : null}
          </div>
          <input
            className="w-full rounded-xl border border-zinc-200 px-4 py-3"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="min-h-28 w-full rounded-xl border border-zinc-200 px-4 py-3"
            placeholder="Description"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          {showPrices ? (
            <input
              className="w-full rounded-xl border border-zinc-200 px-4 py-3"
              placeholder="Price (USD)"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          ) : null}
          <div>
            <p className="mb-2 text-sm font-semibold">Category</p>
            <div className="flex flex-wrap gap-2">
              {LISTING_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                    category === cat
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-800"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
          <button
            type="submit"
            disabled={busy || photoBusy}
            className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Posting…" : photoBusy ? "Uploading photo…" : "Post listing"}
          </button>
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-xl font-semibold">Your listings</h2>
        <div className="space-y-3">
          {myListings.map(item => (
            <ListingCard
              key={item.id}
              item={item}
              href={`/listing/${item.id}`}
            />
          ))}
          {myListings.length === 0 ? (
            <p className="text-zinc-500">No listings yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
