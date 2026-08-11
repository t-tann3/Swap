"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import type { MarketplaceRole } from "../../lib/types";

export default function OnboardingPage() {
  const { setRoles } = useMarketplace();
  const router = useRouter();
  const [selected, setSelected] = useState<MarketplaceRole[]>([]);
  const [busy, setBusy] = useState(false);

  function toggle(role: MarketplaceRole) {
    setSelected(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role],
    );
  }

  async function onContinue() {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      await setRoles(selected);
      router.replace(selected.includes("buyer") ? "/browse" : "/sell");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Swap</h1>
        <h2 className="mt-3 text-xl font-semibold">How will you use Swap?</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Pick one or both. You can change this later in Account.
        </p>
        <div className="mt-6 space-y-3">
          {(
            [
              [
                "buyer",
                "Neighbor",
                "Browse the pantry and pick up baskets.",
              ],
              [
                "seller",
                "Pantry",
                "Stock the pantry and fulfill neighbor orders.",
              ],
            ] as const
          ).map(([role, title, body]) => (
            <button
              key={role}
              type="button"
              onClick={() => toggle(role)}
              className={`w-full rounded-xl border-2 p-4 text-left ${
                selected.includes(role)
                  ? "border-zinc-900"
                  : "border-transparent bg-zinc-50"
              }`}
            >
              <div className="font-semibold">{title}</div>
              <div className="text-sm text-zinc-600">{body}</div>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!selected.length || busy}
          onClick={() => void onContinue()}
          className="mt-6 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
