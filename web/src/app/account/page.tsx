"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../../context/AuthContext";
import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import type { MarketplaceRole } from "../../lib/types";

export default function AccountPage() {
  const { me, signOut } = useAuth();
  const {
    profile,
    setRoles,
    ordersAsBuyer,
    ordersAsSeller,
    myListings,
    favorites,
    refresh,
  } = useMarketplace();
  const roles = profile?.roles ?? [];
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await apiRequest<{
          enabled: boolean;
          payoutsReady: boolean;
        }>("/api/payments/connect/status", { auth: true });
        setPaymentsEnabled(status.enabled);
        setPayoutsReady(status.payoutsReady);
      } catch {
        // ignore
      }
    })();
  }, [profile?.userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "return" || params.get("connect") === "refresh") {
      setConnectMsg(
        params.get("connect") === "return"
          ? "Returned from Stripe. Refreshing payout status…"
          : "Restart Connect onboarding if setup is incomplete.",
      );
      void apiRequest<{ payoutsReady: boolean }>(
        "/api/payments/connect/status",
        { auth: true },
      )
        .then(s => {
          setPayoutsReady(s.payoutsReady);
          setPaymentsEnabled(true);
        })
        .finally(() => void refresh());
    }
  }, [refresh]);

  async function toggle(role: MarketplaceRole) {
    const next = roles.includes(role)
      ? roles.filter(r => r !== role)
      : [...roles, role];
    if (!next.length) return;
    await setRoles(next);
  }

  async function startConnect() {
    setConnectBusy(true);
    setConnectMsg(null);
    try {
      const { url } = await apiRequest<{ url: string }>(
        "/api/payments/connect/onboard",
        { method: "POST", auth: true, body: "{}" },
      );
      window.location.href = url;
    } catch (err) {
      setConnectMsg(err instanceof Error ? err.message : "Connect failed");
      setConnectBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-zinc-500">
        Signed in as
      </p>
      <p className="font-medium">{me?.email ?? me?.user_id}</p>
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
        Environment
      </p>
      <p className="font-medium">{me?.app.environment}</p>

      <h2 className="mt-8 text-lg font-semibold">Roles</h2>
      <div className="mt-3 space-y-2">
        {(["buyer", "seller"] as const).map(role => (
          <button
            key={role}
            type="button"
            onClick={() => void toggle(role)}
            className={`w-full rounded-xl border-2 px-4 py-3 text-left font-semibold capitalize ${
              roles.includes(role) ? "border-zinc-900" : "border-zinc-100"
            }`}
          >
            {role}
          </button>
        ))}
      </div>

      {roles.includes("seller") && paymentsEnabled ? (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Seller payouts</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Stripe Connect holds buyer payments until pickup, then transfers your
            share (minus platform fee).
          </p>
          <p className="mt-2 text-sm font-medium">
            Status:{" "}
            {payoutsReady ? "Ready to receive payouts" : "Setup required"}
          </p>
          {connectMsg ? (
            <p className="mt-2 text-sm text-zinc-600">{connectMsg}</p>
          ) : null}
          {!payoutsReady ? (
            <button
              type="button"
              disabled={connectBusy}
              onClick={() => void startConnect()}
              className="mt-4 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
            >
              {connectBusy ? "Opening Stripe…" : "Set up Stripe payouts"}
            </button>
          ) : null}
        </div>
      ) : null}

      <h2 className="mt-8 text-lg font-semibold">Activity</h2>
      <ul className="mt-2 space-y-1 text-sm text-zinc-700">
        <li>Purchases: {ordersAsBuyer.length}</li>
        <li>Sales: {ordersAsSeller.length}</li>
        <li>Listings: {myListings.length}</li>
        <li>Favorites: {favorites.length}</li>
      </ul>

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-8 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white"
      >
        Sign out
      </button>
    </div>
  );
}
