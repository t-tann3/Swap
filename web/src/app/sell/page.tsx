"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { ListingCard } from "../../components/ListingCard";
import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import {
  LISTING_CATEGORIES,
  type ListingCategory,
} from "../../lib/categories";
import { fileToBase64, mediaUrl } from "../../lib/media";

export default function SellPage() {
  const { profile, myListings, createListing, showPrices, pantryMode } =
    useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQty, setStockQty] = useState("1");
  const [maxPerOrder, setMaxPerOrder] = useState("1");
  const [category, setCategory] = useState<ListingCategory>("General");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);

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

  async function onBarcodeLookup() {
    const code = barcode.replace(/\D/g, "");
    if (code.length < 8) {
      setMessage("Enter an 8–14 digit barcode (UPC/EAN).");
      return;
    }
    setLookupBusy(true);
    setMessage(null);
    try {
      const product = await apiRequest<{
        title: string;
        description: string;
        category: ListingCategory;
        imageUrl: string | null;
        barcode: string;
      }>(`/api/products/barcode/${encodeURIComponent(code)}`, { auth: true });
      setTitle(product.title);
      setDescription(product.description);
      setCategory(product.category);
      if (product.imageUrl) setImageUrl(product.imageUrl);
      setMessage(
        `Filled from barcode ${product.barcode}. Set stock and list food.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Barcode lookup failed");
    } finally {
      setLookupBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const dollars = showPrices ? Number.parseFloat(price) : 0;
    const stock = pantryMode ? Number.parseInt(stockQty, 10) : 1;
    const itemCap = pantryMode ? Number.parseInt(maxPerOrder, 10) : 1;
    if (
      !title.trim() ||
      !description.trim() ||
      (showPrices && Number.isNaN(dollars)) ||
      (pantryMode &&
        (!Number.isFinite(stock) ||
          stock < 1 ||
          !Number.isFinite(itemCap) ||
          itemCap < 1))
    ) {
      setMessage(
        showPrices
          ? "Add a title, description, and valid price."
          : pantryMode
            ? "Add a title, description, stock, and per-patron item cap."
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
        stockQty: pantryMode ? stock : 1,
        maxPerOrder: pantryMode ? itemCap : 1,
      });
      setTitle("");
      setDescription("");
      setPrice("");
      setStockQty("1");
      setMaxPerOrder("1");
      setCategory("General");
      setImageUrl(null);
      setMessage(pantryMode ? "Food listed for pantry." : "Listing posted.");
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
        <h1 className="text-2xl font-bold">
          {pantryMode ? "Stock pantry food" : "Post an item"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {pantryMode
            ? "Look up a barcode to fill title and catalog photo, then set stock."
            : "Items must fit a Relai Exchange Zone compartment. All doors are the same size. A listing photo is optional."}
        </p>
        {pantryMode ? (
          <p className="mt-2 text-sm">
            <Link href="/inventory" className="font-semibold text-zinc-900 underline">
              Open inventory
            </Link>{" "}
            to see available vs reserved and adjust stock.
          </p>
        ) : null}
        {pantryMode ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Barcode (UPC/EAN)"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              className="min-w-[12rem] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={lookupBusy || busy}
              onClick={() => void onBarcodeLookup()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {lookupBusy ? "Looking up…" : "Look up"}
            </button>
          </div>
        ) : null}
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
          {pantryMode ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                Stock on shelf
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-3 font-normal"
                  value={stockQty}
                  onChange={e => setStockQty(e.target.value)}
                />
                <span className="mt-1 block text-xs font-normal text-zinc-500">
                  How many units you have available.
                </span>
              </label>
              <label className="block text-sm font-semibold">
                Max per patron (this item)
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-3 font-normal"
                  value={maxPerOrder}
                  onChange={e => setMaxPerOrder(e.target.value)}
                />
                <span className="mt-1 block text-xs font-normal text-zinc-500">
                  Cap for this food in one basket (separate from the Admin
                  total-unit patron cap).
                </span>
              </label>
            </div>
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
