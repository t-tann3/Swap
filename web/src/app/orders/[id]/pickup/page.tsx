"use client";

import { Intents, RelaiApiError } from "@relai-team/access-sdk";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMarketplace } from "../../../../context/MarketplaceContext";
import { apiRequest } from "../../../../lib/api";
import { getRelai } from "../../../../lib/relai/client";
import { createSandboxTransport } from "../../../../lib/relai/transport";
import type { Order } from "../../../../lib/types";

/**
 * Web pick-up redeems the Relai access link via simulated transport only.
 * No physical BLE unlock.
 */
export default function PickupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { completeOrder } = useMarketplace();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<Order>(`/api/orders/${params.id}`, { auth: true })
      .then(setOrder)
      .catch(err =>
        setError(err instanceof Error ? err.message : "Order not found"),
      );
  }, [params.id]);

  async function onPickup() {
    if (!order?.pickupLinkCode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const relai = getRelai();
      const target = await relai.accessLinks.resolve(order.pickupLinkCode);
      await relai.unlock({
        orderId: target.order_id,
        intent: Intents.MakeAvailable,
        accessLink: order.pickupLinkCode,
        transport: createSandboxTransport(),
      });
      await completeOrder(order.id);
      router.push("/orders");
    } catch (err) {
      if (err instanceof RelaiApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : "Pick-up failed");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!order && !error) return <p className="text-zinc-500">Loading…</p>;
  if (!order) return <p className="text-red-600">{error}</p>;

  return (
    <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Pick up</h1>
      <p className="mt-2 font-semibold">{order.listing?.title ?? "Order"}</p>
      <p className="mt-2 text-sm text-zinc-600 whitespace-pre-line">
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </p>

      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">
        Your pickup link
      </p>
      <div className="mt-2 rounded-xl bg-zinc-100 p-4">
        <p className="break-all font-mono text-sm font-semibold">
          {order.pickupLinkCode ?? "Not available yet"}
        </p>
        {order.pickupLinkExpiresAt ? (
          <p className="mt-2 text-xs text-zinc-500">
            Expires {new Date(order.pickupLinkExpiresAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-zinc-700">
        Redeem the Relai access link with simulated transport. Physical
        compartments are only opened from the mobile app with real hardware.
      </p>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        disabled={busy || !order.pickupLinkCode}
        onClick={() => void onPickup()}
        className="mt-6 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Picking up…" : "Complete pick-up"}
      </button>
    </div>
  );
}
