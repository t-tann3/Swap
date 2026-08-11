import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type {
  CheckoutExchangeZone,
  CreateListingInput,
  DropOffPayload,
  Listing,
  MarketplaceRole,
  Order,
  UserProfile,
} from "./types";

const ACTIVE_MODE_KEY = "swap.activeMarketplaceMode";

interface MarketplaceContextValue {
  profile: UserProfile | null;
  listings: Listing[];
  favorites: Listing[];
  ordersAsBuyer: Order[];
  ordersAsSeller: Order[];
  categories: string[];
  /** Stripe escrow on. False for pantry / free-swap mode. */
  paymentsEnabled: boolean;
  /** Hide dollar amounts in the UI when commerce is off. */
  showPrices: boolean;
  pantryMode: boolean;
  defaultPatronCap: number;
  /** Account switch: which persona the UI is using right now. */
  activeMode: "buyer" | "seller";
  setActiveMode: (mode: "buyer" | "seller") => Promise<void>;
  ready: boolean;
  refreshing: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  refresh: () => Promise<void>;
  setRoles: (
    roles: MarketplaceRole[],
    bio?: string,
    adminEnabled?: boolean,
  ) => Promise<void>;
  createListing: (input: CreateListingInput) => Promise<Listing>;
  updateListing: (
    id: string,
    input: Partial<CreateListingInput>,
  ) => Promise<Listing>;
  deleteListing: (id: string) => Promise<void>;
  buyListing: (
    listingId: string,
    exchangeZone: CheckoutExchangeZone,
  ) => Promise<Order>;
  acceptOrder: (orderId: string) => Promise<Order>;
  recordDropOff: (orderId: string, payload: DropOffPayload) => Promise<Order>;
  completeOrder: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  refundOrder: (orderId: string) => Promise<void>;
  disputeOrder: (orderId: string, reason: string) => Promise<void>;
  toggleFavorite: (listingId: string) => Promise<void>;
  isFavorite: (listingId: string) => boolean;
  myListings: Listing[];
  availableListings: Listing[];
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const { me, status } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [myListingsState, setMyListingsState] = useState<Listing[]>([]);
  const [favorites, setFavorites] = useState<Listing[]>([]);
  const [ordersAsBuyer, setOrdersAsBuyer] = useState<Order[]>([]);
  const [ordersAsSeller, setOrdersAsSeller] = useState<Order[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [pantryMode, setPantryMode] = useState(false);
  const [defaultPatronCap, setDefaultPatronCap] = useState(5);
  const [activeMode, setActiveModeState] = useState<"buyer" | "seller">("buyer");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(ACTIVE_MODE_KEY);
        if (
          !cancelled &&
          (stored === "buyer" || stored === "seller")
        ) {
          setActiveModeState(stored);
        }
      } catch {
        // keep default
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep activeMode valid for the roles the user actually has.
  useEffect(() => {
    const roles = profile?.roles ?? [];
    if (roles.includes(activeMode)) return;
    if (roles.includes("buyer")) setActiveModeState("buyer");
    else if (roles.includes("seller")) setActiveModeState("seller");
  }, [profile?.roles, activeMode]);

  const setActiveMode = useCallback(async (mode: "buyer" | "seller") => {
    setActiveModeState(mode);
    try {
      await AsyncStorage.setItem(ACTIVE_MODE_KEY, mode);
    } catch {
      // non-fatal
    }
  }, []);

  const refresh = useCallback(async () => {
    if (status !== "signedIn" || !me) return;
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "available");
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedCategory) params.set("category", selectedCategory);

      const mineParams = new URLSearchParams({
        sellerUserId: me.user_id,
        status: "all",
      });

      const [
        profileRes,
        listingsRes,
        mineRes,
        catsRes,
        favRes,
        buyOrders,
        sellOrders,
        payCfg,
      ] = await Promise.all([
        apiRequest<UserProfile>("/api/me/profile", { auth: true }),
        apiRequest<{ data: Listing[] }>(`/api/listings?${params.toString()}`),
        apiRequest<{ data: Listing[] }>(`/api/listings?${mineParams}`),
        apiRequest<{ data: string[] }>("/api/categories"),
        apiRequest<{ data: Listing[] }>("/api/favorites", { auth: true }),
        apiRequest<{ data: Order[] }>("/api/orders?as=buyer", { auth: true }),
        apiRequest<{ data: Order[] }>("/api/orders?as=seller", {
          auth: true,
        }),
        apiRequest<{
          enabled: boolean;
          showPrices?: boolean;
          pantryMode?: boolean;
          defaultPatronCap?: number;
        }>("/api/payments/config"),
      ]);

      setProfile({
        userId: profileRes.userId,
        email: profileRes.email,
        name: profileRes.name,
        roles: profileRes.roles ?? [],
        bio: profileRes.bio ?? "",
        patronCap: profileRes.patronCap ?? null,
        isPantrySeller: profileRes.isPantrySeller ?? false,
        adminOptOut: profileRes.adminOptOut ?? false,
        adminEligible: profileRes.adminEligible ?? false,
      });
      setListings(listingsRes.data);
      setMyListingsState(mineRes.data.filter(l => l.status !== "cancelled"));
      setCategories(catsRes.data);
      setFavorites(favRes.data);
      setOrdersAsBuyer(buyOrders.data);
      setOrdersAsSeller(sellOrders.data);
      setPaymentsEnabled(payCfg.enabled);
      setShowPrices(payCfg.showPrices ?? payCfg.enabled);
      setPantryMode(Boolean(payCfg.pantryMode));
      setDefaultPatronCap(payCfg.defaultPatronCap ?? 5);
    } finally {
      setRefreshing(false);
      setReady(true);
    }
  }, [me, searchQuery, selectedCategory, status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (status !== "signedIn" || !me) {
        setProfile(null);
        setListings([]);
        setReady(status !== "booting");
        return;
      }
      try {
        await refresh();
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, status, refresh]);

  const setRoles = useCallback(
    async (roles: MarketplaceRole[], bio?: string, adminEnabled?: boolean) => {
      const selfServe = roles.filter(r => r === "buyer" || r === "seller");
      const body: Record<string, unknown> = { roles: selfServe, bio };
      if (adminEnabled !== undefined) body.adminEnabled = adminEnabled;
      const next = await apiRequest<UserProfile>("/api/me/profile", {
        method: "PUT",
        auth: true,
        body: JSON.stringify(body),
      });
      setProfile({
        userId: next.userId,
        email: next.email,
        name: next.name,
        roles: next.roles,
        bio: next.bio ?? "",
        patronCap: next.patronCap ?? null,
        isPantrySeller: next.isPantrySeller ?? false,
        adminOptOut: next.adminOptOut ?? false,
        adminEligible: next.adminEligible ?? false,
      });
    },
    [],
  );

  const createListing = useCallback(async (input: CreateListingInput) => {
    const listing = await apiRequest<Listing>("/api/listings", {
      method: "POST",
      auth: true,
      body: JSON.stringify(input),
    });
    await refresh();
    return listing;
  }, [refresh]);

  const updateListing = useCallback(
    async (id: string, input: Partial<CreateListingInput>) => {
      const listing = await apiRequest<Listing>(`/api/listings/${id}`, {
        method: "PATCH",
        auth: true,
        body: JSON.stringify(input),
      });
      await refresh();
      return listing;
    },
    [refresh],
  );

  const deleteListing = useCallback(
    async (id: string) => {
      await apiRequest(`/api/listings/${id}`, { method: "DELETE", auth: true });
      await refresh();
    },
    [refresh],
  );

  const buyListing = useCallback(
    async (listingId: string, exchangeZone: CheckoutExchangeZone) => {
      const result = await apiRequest<{ order: Order }>(
        `/api/listings/${listingId}/buy`,
        {
          method: "POST",
          auth: true,
          body: JSON.stringify(exchangeZone),
        },
      );
      await refresh();
      return result.order;
    },
    [refresh],
  );

  const acceptOrder = useCallback(
    async (orderId: string) => {
      const order = await apiRequest<Order>(`/api/orders/${orderId}/accept`, {
        method: "POST",
        auth: true,
      });
      await refresh();
      return order;
    },
    [refresh],
  );

  const recordDropOff = useCallback(
    async (orderId: string, payload: DropOffPayload) => {
      const order = await apiRequest<Order>(`/api/orders/${orderId}/drop-off`, {
        method: "POST",
        auth: true,
        body: JSON.stringify(payload),
      });
      await refresh();
      return order;
    },
    [refresh],
  );

  const completeOrder = useCallback(
    async (orderId: string) => {
      await apiRequest(`/api/orders/${orderId}/complete`, {
        method: "POST",
        auth: true,
      });
      await refresh();
    },
    [refresh],
  );

  const cancelOrder = useCallback(
    async (orderId: string) => {
      await apiRequest(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        auth: true,
      });
      await refresh();
    },
    [refresh],
  );

  const refundOrder = useCallback(
    async (orderId: string) => {
      await apiRequest(`/api/orders/${orderId}/refund`, {
        method: "POST",
        auth: true,
      });
      await refresh();
    },
    [refresh],
  );

  const disputeOrder = useCallback(
    async (orderId: string, reason: string) => {
      await apiRequest(`/api/orders/${orderId}/dispute`, {
        method: "POST",
        auth: true,
        body: JSON.stringify({ reason }),
      });
      await refresh();
    },
    [refresh],
  );

  const toggleFavorite = useCallback(
    async (listingId: string) => {
      const liked = favorites.some(f => f.id === listingId);
      if (liked) {
        await apiRequest(`/api/favorites/${listingId}`, {
          method: "DELETE",
          auth: true,
        });
      } else {
        await apiRequest(`/api/favorites/${listingId}`, {
          method: "POST",
          auth: true,
        });
      }
      await refresh();
    },
    [favorites, refresh],
  );

  const isFavorite = useCallback(
    (listingId: string) => favorites.some(f => f.id === listingId),
    [favorites],
  );

  const myListings = myListingsState;

  const availableListings = useMemo(
    () =>
      listings.filter(l => {
        if (l.status !== "available") return false;
        // Marketplace: hide your own posts so you cannot buy them.
        // Pantry: show the full shelf (staff often use one account to stock + browse).
        if (pantryMode) return true;
        return l.sellerUserId !== me?.user_id;
      }),
    [listings, me?.user_id, pantryMode],
  );

  const value = useMemo(
    () => ({
      profile,
      listings,
      favorites,
      ordersAsBuyer,
      ordersAsSeller,
      categories,
      paymentsEnabled,
      showPrices,
      pantryMode,
      defaultPatronCap,
      activeMode,
      setActiveMode,
      ready,
      refreshing,
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      refresh,
      setRoles,
      createListing,
      updateListing,
      deleteListing,
      buyListing,
      acceptOrder,
      recordDropOff,
      completeOrder,
      cancelOrder,
      refundOrder,
      disputeOrder,
      toggleFavorite,
      isFavorite,
      myListings,
      availableListings,
    }),
    [
      profile,
      listings,
      favorites,
      ordersAsBuyer,
      ordersAsSeller,
      categories,
      paymentsEnabled,
      showPrices,
      pantryMode,
      defaultPatronCap,
      activeMode,
      setActiveMode,
      ready,
      refreshing,
      searchQuery,
      selectedCategory,
      refresh,
      setRoles,
      createListing,
      updateListing,
      deleteListing,
      buyListing,
      acceptOrder,
      recordDropOff,
      completeOrder,
      cancelOrder,
      refundOrder,
      disputeOrder,
      toggleFavorite,
      isFavorite,
      myListings,
      availableListings,
    ],
  );

  return (
    <MarketplaceContext.Provider value={value}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace(): MarketplaceContextValue {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) {
    throw new Error("useMarketplace must be used within MarketplaceProvider");
  }
  return ctx;
}
