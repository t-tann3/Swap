"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "../context/AuthContext";
import { useMarketplace } from "../context/MarketplaceContext";

const marketplaceLinks = [
  { href: "/browse", label: "Browse", role: "buyer" as const },
  { href: "/basket", label: "Basket", role: "buyer" as const },
  { href: "/favorites", label: "Saved", role: "buyer" as const },
  { href: "/sell", label: "Pantry", role: "seller" as const },
  { href: "/inventory", label: "Inventory", role: "seller" as const },
  { href: "/team", label: "Team", role: "seller" as const },
  { href: "/members", label: "Members", role: "seller" as const },
  { href: "/orders", label: "Orders", role: "market" as const },
  { href: "/account", label: "Account", role: "any" as const },
];

const adminLinks = [
  { href: "/admin", label: "Admin" },
  { href: "/account", label: "Account" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { profile, ready, pantryMode } = useMarketplace();
  const pathname = usePathname();
  const router = useRouter();

  const roles = profile?.roles ?? [];
  const isAdmin =
    roles.includes("admin") &&
    !roles.includes("buyer") &&
    !roles.includes("seller");
  const isBuyer = roles.includes("buyer") && !roles.includes("seller");
  const isSeller = roles.includes("seller") && !roles.includes("buyer");
  const persona: "buyer" | "seller" | "admin" | null = isBuyer
    ? "buyer"
    : isSeller
      ? "seller"
      : isAdmin
        ? "admin"
        : null;

  useEffect(() => {
    if (status === "signedOut" && !pathname.startsWith("/login")) {
      router.replace("/login");
    }
  }, [status, pathname, router]);

  useEffect(() => {
    if (
      status === "signedIn" &&
      ready &&
      profile &&
      !persona &&
      pathname !== "/onboarding"
    ) {
      router.replace("/onboarding");
    }
  }, [status, ready, profile, persona, pathname, router]);

  useEffect(() => {
    if (status !== "signedIn" || !ready || !persona) return;
    if (
      persona === "buyer" &&
      (pathname.startsWith("/sell") ||
        pathname.startsWith("/inventory") ||
        pathname.startsWith("/team") ||
        pathname.startsWith("/members") ||
        pathname.startsWith("/admin"))
    ) {
      router.replace("/browse");
      return;
    }
    if (
      persona === "seller" &&
      (pathname.startsWith("/browse") ||
        pathname.startsWith("/basket") ||
        pathname.startsWith("/favorites") ||
        pathname.startsWith("/checkout") ||
        pathname.startsWith("/admin"))
    ) {
      router.replace("/sell");
      return;
    }
    if (
      persona === "admin" &&
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/account")
    ) {
      router.replace("/admin");
    }
  }, [status, ready, persona, pathname, router]);

  if (status === "booting" || (status === "signedIn" && !ready)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] text-zinc-600">
        Loading Swap…
      </div>
    );
  }

  if (pathname.startsWith("/login") || pathname.startsWith("/onboarding")) {
    return <>{children}</>;
  }

  if (status !== "signedIn") {
    return null;
  }

  if (profile && !persona) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] text-zinc-600">
        Taking you to choose your account type…
      </div>
    );
  }

  const links = isAdmin
    ? adminLinks
    : marketplaceLinks.filter(l => {
        if (l.href === "/basket" && !pantryMode) return false;
        if (l.href === "/inventory" && !pantryMode) return false;
        if (l.href === "/team" && !pantryMode) return false;
        if (l.href === "/members" && !pantryMode) return false;
        if (l.role === "any") return true;
        if (l.role === "market") return isBuyer || isSeller;
        if (l.role === "buyer") return isBuyer;
        if (l.role === "seller") return isSeller;
        return false;
      });

  const homeHref = isBuyer
    ? "/browse"
    : isSeller
      ? "/sell"
      : isAdmin
        ? "/admin"
        : "/account";

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={homeHref}
            className="text-xl font-bold tracking-tight"
          >
            Swap
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {links.map(l => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
