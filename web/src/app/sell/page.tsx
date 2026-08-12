"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import Link from "next/link";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import {
  DEFAULT_PANTRY_CATEGORY,
  LISTING_CATEGORIES,
  type ListingCategory,
} from "../../lib/categories";
import { fileToBase64, mediaUrl } from "../../lib/media";

export default function SellPage() {
  const { profile, createListing, showPrices, pantryMode } = useMarketplace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQty, setStockQty] = useState("1");
  const [maxPerOrder, setMaxPerOrder] = useState("1");
  const [category, setCategory] = useState<ListingCategory>(
    DEFAULT_PANTRY_CATEGORY,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const [barcode, setBarcode] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!profile?.roles.includes("seller")) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-8">
        <h1 className="text-xl font-semibold">Pantry access required</h1>
        <p className="mt-2 text-zinc-600">
          Switch to the Pantry experience in Account to stock food.
        </p>
        <Link
          href="/account"
          className="mt-4 inline-block font-semibold text-zinc-900 underline"
        >
          Go to Account
        </Link>
      </div>
    );
  }

  function flash(text: string, tone: "ok" | "err" = "ok") {
    setMessage(text);
    setMessageTone(tone);
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const { imageBase64, mimeType } = await fileToBase64(file);
      const res = await apiRequest<{ url: string }>("/api/uploads", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      setImageUrl(res.url);
      flash("Photo added — review details and add to shelf.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Photo upload failed", "err");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onBarcodeLookup() {
    const code = barcode.replace(/\D/g, "");
    if (code.length < 8) {
      flash("Enter an 8–14 digit barcode.", "err");
      return;
    }
    setLookupBusy(true);
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
      setCategory(product.category || DEFAULT_PANTRY_CATEGORY);
      if (product.imageUrl) setImageUrl(product.imageUrl);
      flash(
        product.imageUrl
          ? "Filled from barcode. Replace the photo anytime, then set stock."
          : "Filled from barcode. Add a photo if you have one, then set stock.",
      );
    } catch (err) {
      flash(
        err instanceof Error ? err.message : "Barcode lookup failed",
        "err",
      );
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
      flash(
        pantryMode
          ? "Add a title, description, and stock amounts."
          : showPrices
            ? "Add a title, description, and valid price."
            : "Add a title and description.",
        "err",
      );
      return;
    }
    setBusy(true);
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
      setCategory(DEFAULT_PANTRY_CATEGORY);
      setImageUrl(null);
      setBarcode("");
      flash(pantryMode ? "Added to the shelf." : "Listing posted.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not post", "err");
    } finally {
      setBusy(false);
    }
  }

  const preview = mediaUrl(imageUrl);
  const canPost =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    !busy &&
    !photoBusy;

  if (!pantryMode) {
    return (
      <div className="mx-auto max-w-xl">
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl bg-white p-6 shadow-sm"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Post an item</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Must fit a Relai Exchange Zone compartment. Photo optional.
            </p>
          </div>
          <PhotoField
            preview={preview}
            photoBusy={photoBusy}
            disabled={busy}
            fileRef={fileRef}
            onPick={file => void onFileChange(file)}
            onRemove={() => setImageUrl(null)}
          />
          <input
            className="w-full rounded-xl border border-zinc-200 px-4 py-3"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="min-h-24 w-full rounded-xl border border-zinc-200 px-4 py-3"
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
          <CategoryList category={category} onChange={setCategory} />
          {message ? (
            <p
              className={`text-sm ${messageTone === "err" ? "text-red-700" : "text-emerald-800"}`}
            >
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canPost}
            className="w-full rounded-xl bg-zinc-900 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Posting…" : "Post listing"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl pb-10 pt-2">
      <header className="mb-10">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
          Pantry
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Add to shelf
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600">
          Scan a barcode to autofill, or enter details yourself. Neighbors
          will see this on Browse.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-8">
          {/* 1 — Scan */}
          <section className="rounded-2xl bg-white px-6 py-7 shadow-sm ring-1 ring-zinc-100">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
                1 · Scan
              </h2>
              <span className="text-xs text-zinc-400">Optional</span>
            </div>
            <div className="mt-5 flex gap-3">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Barcode number"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onBarcodeLookup();
                  }
                }}
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-4 py-3.5 text-base"
              />
              <button
                type="button"
                disabled={lookupBusy || busy}
                onClick={() => void onBarcodeLookup()}
                className="shrink-0 rounded-xl bg-zinc-900 px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {lookupBusy ? "…" : "Look up"}
              </button>
            </div>
          </section>

          {/* 2 — Item */}
          <section className="rounded-2xl bg-white px-6 py-7 shadow-sm ring-1 ring-zinc-100">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
              2 · Item
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-[148px_minmax(0,1fr)]">
              <PhotoField
                preview={preview}
                photoBusy={photoBusy}
                disabled={busy}
                fileRef={fileRef}
                onPick={file => void onFileChange(file)}
                onRemove={() => setImageUrl(null)}
                compact
              />
              <div className="space-y-4">
                <input
                  className="w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-base"
                  placeholder="What is it?"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
                <textarea
                  className="min-h-[6.5rem] w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-base"
                  placeholder="Brand, size, notes for neighbors…"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-8 border-t border-zinc-100 pt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Category
              </p>
              <CategoryList category={category} onChange={setCategory} />
            </div>
          </section>

          {/* 3 — Stock */}
          <section className="rounded-2xl bg-white px-6 py-7 shadow-sm ring-1 ring-zinc-100">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
              3 · How many
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold">On the shelf</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-lg font-semibold tabular-nums"
                  value={stockQty}
                  onChange={e => setStockQty(e.target.value)}
                />
                <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">
                  Units available now
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Limit per basket</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-lg font-semibold tabular-nums"
                  value={maxPerOrder}
                  onChange={e => setMaxPerOrder(e.target.value)}
                />
                <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">
                  Max of this item a neighbor can take
                </span>
              </label>
            </div>
          </section>

          {message ? (
            <p
              className={`rounded-xl px-4 py-3.5 text-sm font-medium ${
                messageTone === "err"
                  ? "bg-red-50 text-red-800"
                  : "bg-emerald-50 text-emerald-900"
              }`}
            >
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canPost}
            className="w-full rounded-2xl bg-zinc-900 py-4 text-base font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {busy
              ? "Adding…"
              : photoBusy
                ? "Uploading photo…"
                : "Add to shelf"}
          </button>
        </form>
    </div>
  );
}

function PhotoField({
  preview,
  photoBusy,
  disabled,
  fileRef,
  onPick,
  onRemove,
  compact = false,
}: {
  preview: string | null;
  photoBusy: boolean;
  disabled: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled || photoBusy}
        onChange={e => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={disabled || photoBusy}
        onClick={() => fileRef.current?.click()}
        className={`group relative w-full overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-left transition hover:border-zinc-400 hover:bg-zinc-100 disabled:opacity-50 ${
          compact ? "aspect-square" : "h-44"
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Item"
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className={`flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-zinc-500 ${
              compact ? "text-xs" : "text-sm"
            }`}
          >
            <span className="font-semibold text-zinc-700">
              {photoBusy ? "Uploading…" : "Add photo"}
            </span>
            {!compact ? (
              <span className="text-xs">Tap to choose from your device</span>
            ) : null}
          </span>
        )}
      </button>
      {preview ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-semibold text-zinc-500 underline"
          onClick={onRemove}
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function CategoryList({
  category,
  onChange,
}: {
  category: ListingCategory;
  onChange: (c: ListingCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const canScroll = el.scrollHeight > el.clientHeight;
      if (!canScroll) return;
      const atTop = el.scrollTop <= 0;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
        el.scrollTop += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-left text-sm font-semibold text-zinc-900"
      >
        <span>{category}</span>
        <span className="text-xs font-medium text-zinc-400">
          {open ? "Close" : "Change"}
        </span>
      </button>
      {open ? (
        <div
          ref={scrollerRef}
          role="listbox"
          aria-label="Category"
          className="absolute z-20 mt-2 max-h-52 w-full overflow-y-scroll overscroll-contain rounded-xl border border-zinc-200 bg-white py-1 shadow-lg [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400"
        >
          <ul className="m-0 list-none p-0">
            {LISTING_CATEGORIES.map(cat => {
              const selected = category === cat;
              return (
                <li key={cat} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(cat);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold transition ${
                      selected
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-800 hover:bg-zinc-50"
                    }`}
                  >
                    <span>{cat}</span>
                    {selected ? (
                      <span className="text-xs font-medium text-zinc-300">
                        Selected
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
