"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import type { ExchangeZone } from "@relai-team/access-sdk";
import { RelaiApiError } from "@relai-team/access-sdk";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useMarketplace } from "../../../context/MarketplaceContext";
import { apiRequest } from "../../../lib/api";
import { getRelai } from "../../../lib/relai/client";
import type { Listing } from "../../../lib/types";

function formatNextOpen(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function PaymentStep({
  listing,
  selected,
  onPaid,
}: {
  listing: Listing;
  selected: ExchangeZone;
  onPaid: (paymentIntentId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError, paymentIntent } =
        await stripe.confirmPayment({
          elements,
          redirect: "if_required",
        });
      if (confirmError) {
        setError(confirmError.message ?? "Payment failed");
        return;
      }
      if (
        !paymentIntent ||
        (paymentIntent.status !== "requires_capture" &&
          paymentIntent.status !== "succeeded")
      ) {
        setError("Payment was not authorized. Try again.");
        return;
      }
      await onPaid(paymentIntent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">Payment</h2>
      <p className="text-sm text-zinc-600">
        Card is authorized now. Swap captures and pays the seller when you pick
        up (${(listing.priceCents / 100).toFixed(2)} held in escrow).
      </p>
      <PaymentElement />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={!stripe || busy}
        onClick={() => void onSubmit()}
        className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-45"
      >
        {busy
          ? "Processing…"
          : `Pay & place order · $${(listing.priceCents / 100).toFixed(2)}`}
      </button>
      <p className="text-xs text-zinc-500">
        Drop-off zone: {selected.name}
        {selected.address ? ` · ${selected.address}` : ""}
      </p>
    </div>
  );
}

export default function CheckoutPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { buyListing } = useMarketplace();
  const [listing, setListing] = useState<Listing | null>(null);
  const [zones, setZones] = useState<ExchangeZone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentsOn, setPaymentsOn] = useState(false);
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [item, ezList, payCfg] = await Promise.all([
          apiRequest<Listing>(`/api/listings/${params.id}`),
          getRelai().exchangeZones.list({ limit: 50 }),
          apiRequest<{
            enabled: boolean;
            publishableKey: string | null;
          }>("/api/payments/config"),
        ]);
        if (cancelled) return;
        setListing(item);
        setZones(ezList);
        const first = ezList.find(z => z.is_open_now && z.nodes_available > 0);
        setSelectedId(first?.id ?? null);
        setPaymentsOn(payCfg.enabled);
        if (payCfg.enabled && payCfg.publishableKey) {
          setStripePromise(loadStripe(payCfg.publishableKey));
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RelaiApiError) {
          setError(`[${err.code}] ${err.message}`);
        } else {
          setError(err instanceof Error ? err.message : "Checkout failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const selected = zones.find(z => z.id === selectedId) ?? null;
  const canContinue =
    !!listing &&
    !!selected &&
    selected.is_open_now &&
    selected.nodes_available > 0 &&
    !busy;

  const elementsOptions = useMemo(
    () =>
      clientSecret
        ? {
            clientSecret,
            appearance: { theme: "stripe" as const },
          }
        : null,
    [clientSecret],
  );

  async function startPayment() {
    if (!listing || !selected || !canContinue) return;
    if (!paymentsOn) {
      setBusy(true);
      setError(null);
      try {
        await buyListing(listing.id, {
          exchangeZoneId: selected.id,
          exchangeZoneName: selected.name,
          exchangeZoneAddress: selected.address,
        });
        router.push("/orders");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not place order");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const pi = await apiRequest<{
        clientSecret: string;
        paymentIntentId: string;
      }>("/api/payments/payment-intents", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ listingId: listing.id }),
      });
      setClientSecret(pi.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  }

  async function finishPaid(paymentIntentId: string) {
    if (!listing || !selected) return;
    await buyListing(listing.id, {
      exchangeZoneId: selected.id,
      exchangeZoneName: selected.name,
      exchangeZoneAddress: selected.address,
      paymentIntentId,
    });
    router.push("/orders");
  }

  if (loading) return <p className="text-zinc-500">Loading checkout…</p>;
  if (!listing) return <p className="text-red-600">{error ?? "Listing not found"}</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="mt-2 text-lg font-semibold">{listing.title}</p>
      {paymentsOn ? (
        <p className="text-xl font-bold">
          ${(listing.priceCents / 100).toFixed(2)}
        </p>
      ) : null}

      <h2 className="mt-8 text-lg font-semibold">
        Choose Exchange Zone for drop-off
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        Open state comes from Relai (`is_open_now`), not your browser clock.
      </p>

      <div className="mt-4 space-y-3">
        {zones.map(item => {
          const selectable = item.is_open_now && item.nodes_available > 0;
          const active = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!selectable || !!clientSecret}
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-xl border-2 bg-white p-4 text-left ${
                active ? "border-zinc-900" : "border-transparent"
              } ${!selectable ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{item.name}</span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                    item.is_open_now
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {item.is_open_now ? "Open now" : "Closed"}
                </span>
              </div>
              {item.address ? (
                <p className="mt-1 text-sm text-zinc-500">{item.address}</p>
              ) : null}
              <p className="mt-1 text-sm text-zinc-500">
                {item.nodes_available} compartment
                {item.nodes_available === 1 ? "" : "s"} available
                {item.is_simulated ? " · Simulated" : ""}
              </p>
              {!item.is_open_now ? (
                <p className="mt-2 text-sm font-medium text-red-700">
                  {item.next_open_at
                    ? `Opens ${formatNextOpen(item.next_open_at, item.timezone)}`
                    : "No upcoming open time"}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>

      {zones.length === 0 ? (
        <p className="mt-4 text-red-600">No Exchange Zones available.</p>
      ) : null}
      {error ? <p className="mt-4 text-red-600">{error}</p> : null}

      {!clientSecret ? (
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => void startPayment()}
          className="mt-6 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-45"
        >
          {busy
            ? "Starting…"
            : paymentsOn
              ? "Continue to payment"
              : "Place order"}
        </button>
      ) : null}

      {clientSecret && stripePromise && elementsOptions && selected ? (
        <Elements stripe={stripePromise} options={elementsOptions}>
          <PaymentStep
            listing={listing}
            selected={selected}
            onPaid={finishPaid}
          />
        </Elements>
      ) : null}
    </div>
  );
}
