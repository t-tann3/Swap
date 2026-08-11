"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiRequest } from "../../../../lib/api";
import type { Order } from "../../../../lib/types";

/**
 * Compartment photo proof is required at drop-off and only available on mobile.
 * Web keeps this page as a redirect notice (no photo capture in browser).
 */
export default function DropOffPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<Order>(`/api/orders/${params.id}`, { auth: true })
      .then(setOrder)
      .catch(err =>
        setError(err instanceof Error ? err.message : "Order not found"),
      );
  }, [params.id]);

  if (!order && !error) return <p className="text-zinc-500">Loading…</p>;
  if (!order) return <p className="text-red-600">{error}</p>;

  return (
    <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Drop off on mobile</h1>
      <p className="mt-2 font-semibold">{order.listing?.title ?? "Order"}</p>
      <p className="mt-2 text-sm text-zinc-600 whitespace-pre-line">
        Exchange Zone: {order.exchangeZoneName}
        {order.exchangeZoneAddress ? `\n${order.exchangeZoneAddress}` : ""}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-zinc-700">
        Drop-off with Relai unlock runs on the Swap mobile app (Orders → Drop
        off item). Compartment photos are optional for now.
      </p>
      <Link
        href="/orders"
        className="mt-6 block w-full rounded-xl bg-zinc-900 py-3 text-center font-semibold text-white"
      >
        Back to orders
      </Link>
    </div>
  );
}
