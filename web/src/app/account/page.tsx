"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../../context/AuthContext";
import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";

export default function AccountPage() {
  const { me, signOut } = useAuth();
  const {
    profile,
    ordersAsBuyer,
    ordersAsSeller,
    myListings,
    favorites,
    refresh,
    pantryMode,
  } = useMarketplace();
  const roles = profile?.roles ?? [];
  const isNeighbor = roles.includes("buyer") && !roles.includes("seller");
  const isPantry = roles.includes("seller") && !roles.includes("buyer");
  const isAdmin =
    roles.includes("admin") && !roles.includes("buyer") && !roles.includes("seller");
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [creditedCents, setCreditedCents] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (isPantry && !pantryMode) {
        try {
          const status = await apiRequest<{
            enabled: boolean;
            payoutsReady: boolean;
            creditedCents?: number;
          }>("/api/payments/connect/status", { auth: true });
          setPaymentsEnabled(status.enabled);
          setPayoutsReady(status.payoutsReady);
          setCreditedCents(status.creditedCents ?? 0);
        } catch {
          // ignore
        }
      } else {
        setPaymentsEnabled(false);
      }
    })();
  }, [profile?.userId, pantryMode, isPantry]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "return" || params.get("connect") === "refresh") {
      setConnectMsg(
        params.get("connect") === "return"
          ? "Returned from Stripe. Refreshing payout status…"
          : "Restart Connect onboarding if setup is incomplete.",
      );
      void apiRequest<{ payoutsReady: boolean; creditedCents?: number }>(
        "/api/payments/connect/status",
        { auth: true },
      )
        .then(s => {
          setPayoutsReady(s.payoutsReady);
          setCreditedCents(s.creditedCents ?? 0);
          setPaymentsEnabled(true);
        })
        .finally(() => void refresh());
    }
  }, [refresh]);

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
        Account type
      </p>
      <p className="font-medium">
        {isAdmin
          ? "Admin account"
          : isPantry
            ? "Pantry account"
            : "Neighbor account"}
      </p>

      {isPantry && paymentsEnabled && !pantryMode ? (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Seller payouts</h2>
          <p className="mt-2 text-sm font-medium">
            Status: {payoutsReady ? "Ready to receive payouts" : "Not set up"}
          </p>
          {creditedCents > 0 ? (
            <p className="mt-1 text-sm font-medium">
              Waiting for you: ${(creditedCents / 100).toFixed(2)}
            </p>
          ) : null}
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
              {connectBusy
                ? "Opening Stripe…"
                : creditedCents > 0
                  ? "Withdraw earnings"
                  : "Set up payouts"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!isAdmin ? (
        <>
          <h2 className="mt-8 text-lg font-semibold">Activity</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-700">
            {isNeighbor ? (
              <>
                <li>Orders: {ordersAsBuyer.length}</li>
                <li>Saved: {favorites.length}</li>
              </>
            ) : (
              <>
                <li>Pantry orders: {ordersAsSeller.length}</li>
                <li>Listings: {myListings.length}</li>
              </>
            )}
          </ul>
        </>
      ) : null}

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
