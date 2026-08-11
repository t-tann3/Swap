"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "../context/AuthContext";
import { MarketplaceProvider } from "../context/MarketplaceContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <MarketplaceProvider>{children}</MarketplaceProvider>
    </AuthProvider>
  );
}
