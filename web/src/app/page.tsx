"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "../context/AuthContext";
import { useMarketplace } from "../context/MarketplaceContext";

export default function HomePage() {
  const { status } = useAuth();
  const { ready, profile } = useMarketplace();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") {
      router.replace("/login");
      return;
    }
    if (status !== "signedIn" || !ready || !profile) return;

    const buyer = profile.roles.includes("buyer");
    const seller = profile.roles.includes("seller");
    if (buyer === seller) {
      // None or both — force exclusive persona pick.
      router.replace("/onboarding");
      return;
    }
    router.replace(buyer ? "/browse" : "/sell");
  }, [status, ready, profile, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-zinc-600">
      Loading Swap…
    </div>
  );
}
