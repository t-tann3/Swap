"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "../context/AuthContext";
import { useMarketplace } from "../context/MarketplaceContext";

const marketplaceLinks = [
  { href: "/browse", label: "Browse", role: "buyer" as const },
  { href: "/favorites", label: "Saved", role: "buyer" as const },
  { href: "/sell", label: "Sell", role: "seller" as const },
  { href: "/orders", label: "Orders", role: null },
  { href: "/account", label: "Account", role: null },
];

const adminLinks = [
  { href: "/admin", label: "Admin" },
  { href: "/account", label: "Account" },
];

const marketplacePaths = [
  "/browse",
  "/favorites",
  "/sell",
  "/orders",
  "/checkout",
  "/listing",
  "/onboarding",
];

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { profile, ready } = useMarketplace();
  const pathname = usePathname();
  const router = useRouter();

  const roles = profile?.roles ?? [];
  const isAdminOnly =
    roles.includes("admin") &&
    !roles.includes("buyer") &&
    !roles.includes("seller");

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
      profile.roles.length === 0 &&
      pathname !== "/onboarding"
    ) {
      router.replace("/onboarding");
    }
  }, [status, ready, profile, pathname, router]);

  useEffect(() => {
    if (!ready || status !== "signedIn" || !isAdminOnly) return;
    if (marketplacePaths.some(p => pathname.startsWith(p))) {
      router.replace("/admin");
    }
  }, [ready, status, isAdminOnly, pathname, router]);

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

  const links = isAdminOnly
    ? adminLinks
    : [
        ...marketplaceLinks.filter(l => !l.role || roles.includes(l.role)),
        ...(roles.includes("admin")
          ? [{ href: "/admin", label: "Admin" }]
          : []),
      ];

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={isAdminOnly ? "/admin" : "/browse"}
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
