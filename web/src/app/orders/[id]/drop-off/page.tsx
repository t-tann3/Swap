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
 * Web drop-off creates the Relai order + simulated open to mint the pickup link.
 * It never uses BleTransport / physical hardware.
 */
export default function DropOffPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { recordDropOff } = useMarketplace();
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

  async function onDropOff() {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    try {
      const relai = getRelai();
      const relaiOrder = await relai.orders.create({
        exchangeZoneId: order.exchangeZoneId,
        handoffMode: "open",
      });
      const result = await relai.unlock({
        orderId: relaiOrder.id,
        intent: Intents.Occupy,
        size: order.compartmentSize ?? order.listing?.compartmentSize ?? "M",
        transport: createSandboxTransport(),
      });
      const link = result.open.access_link;
      if (!link?.code) {
        throw new Error(
          "No pickup link returned. Enable open handoff mode in the Relai portal.",
        );
      }
      await recordDropOff(order.id, {
        relaiOrderId: relaiOrder.id,
        pickupLinkCode: link.code,
        pickupLinkExpiresAt: link.expires_at,
      });
      router.push("/orders");
    } catch (err) {
      if (err instanceof RelaiApiError && err.code === "invalid_request") {
        setError(
          "Relai rejected open handoff for this app. In the Relai portal, enable Handoff mode: Open on your sandbox app, then try again.",
        );
      } else if (err instanceof RelaiApiError && err.code === "payment_required") {
        setError(
          "Relai is charging at the door (Relai checkout). Swap’s Stripe escrow does not pay Relai. In the Relai portal, set Payment mode to App-managed, then try again.",
        );
      } else if (err instanceof RelaiApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : "Drop-off failed");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!order && !error) return <p className="text-zinc-500">Loading…</p>;
  if (!order) return <p className="text-red-600">{error}</p>;

  return (
    <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Drop off</h1>
      <p className="mt-2 font-semibold">{order.listing?.title ?? "Order"}</p>
      <p className="mt-2 text-sm text-zinc-600 whitespace-pre-line">
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-zinc-700">
        This mints a Relai open-handoff pickup link using the sandbox simulated
        transport. No physical compartment is opened from the web app.
      </p>
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={busy || order.status !== "accepted"}
        onClick={() => void onDropOff()}
        className="mt-6 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Dropping off…" : "Complete drop-off & attach pickup link"}
      </button>
    </div>
  );
}
