"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import type { MarketplaceRole } from "../../lib/types";

type Persona = Extract<MarketplaceRole, "buyer" | "seller" | "admin">;

export default function OnboardingPage() {
  const { setRoles, setActiveMode, profile } = useMarketplace();
  const router = useRouter();
  const [selected, setSelected] = useState<Persona | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { role: Persona; title: string; body: string }[] = [
    {
      role: "buyer",
      title: "Neighbor",
      body: "Browse the pantry and pick up baskets.",
    },
    {
      role: "seller",
      title: "Pantry",
      body: "Stock the pantry and fulfill neighbor orders.",
    },
  ];
  if (profile?.adminEligible) {
    options.push({
      role: "admin",
      title: "Admin",
      body: "Operate pantry settings and platform tools.",
    });
  }

  async function onContinue() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (selected === "buyer" || selected === "seller") {
        setActiveMode(selected);
      }
      await setRoles([selected]);
      router.replace(
        selected === "buyer"
          ? "/browse"
          : selected === "seller"
            ? "/sell"
            : "/admin",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save your choice. Is the API server running?",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Swap</h1>
        <h2 className="mt-3 text-xl font-semibold">Choose your account type</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Pick one. Each account type has its own tools and login experience.
        </p>
        <div className="mt-6 space-y-3">
          {options.map(({ role, title, body }) => (
            <button
              key={role}
              type="button"
              onClick={() => setSelected(role)}
              className={`w-full rounded-xl border-2 p-4 text-left ${
                selected === role
                  ? "border-zinc-900"
                  : "border-transparent bg-zinc-50"
              }`}
            >
              <div className="font-semibold">{title}</div>
              <div className="text-sm text-zinc-600">{body}</div>
            </button>
          ))}
        </div>
        {error ? (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => void onContinue()}
          className="mt-6 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
