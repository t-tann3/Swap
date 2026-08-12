/** buyer/seller are self-serve; admin is allowlist-granted only. */
export type MarketplaceRole = "buyer" | "seller" | "admin";

export type ListingStatus =
  | "draft"
  | "available"
  | "reserved"
  | "sold"
  | "out_of_stock"
  | "cancelled";

/**
 * Marketplace order lifecycle (seller drop-off → buyer pick-up via Relai):
 * pending_accept → accepted → ready_for_pickup → completed
 */
export type OrderStatus =
  | "pending_accept"
  | "accepted"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

/** Escrow state for the item price (Relai open fees are separate). */
export type PaymentStatus =
  | "none"
  | "authorized"
  | "captured"
  /**
   * Captured to the platform balance with the seller's share owed to them.
   * Sellers can trade before Stripe payout setup; credits settle as transfers
   * once their Connect account can receive money.
   */
  | "credited"
  | "transferred"
  | "cancelled"
  | "refunded"
  | "disputed";

/** How a completed order finished escrow. */
export type CompletedReason = "pickup" | "no_show" | "admin_release";

/** Why a non-completed order was cancelled / funds returned. */
export type CancelledReason =
  | "buyer_or_seller_cancel"
  | "seller_timeout_accept"
  | "seller_timeout_dropoff"
  | "admin_refund"
  | "dispute_refund"
  | "post_dropoff_refund";

/** How Relai pickup was proven before escrow release. */
export type PickupVerifiedVia = "webhook" | "poll";

/** Stripe dispute lifecycle mirrored onto the order. */
export type DisputeStatus =
  | "needs_response"
  | "under_review"
  | "won"
  | "lost"
  | "warning_closed"
  | "charge_refunded"
  | "warning_needs_response"
  | "warning_under_review";

/** FCM device registration for push (server-only; stripped from client profile). */
export interface PushDevice {
  token: string;
  platform: "ios" | "android";
  updatedAt: string;
}

export interface Profile {
  userId: string;
  email: string | null;
  name: string | null;
  roles: MarketplaceRole[];
  bio: string;
  /** Stripe Connect account id (Accounts v2 / acct_…). */
  stripeAccountId: string | null;
  /** True when recipient stripe_transfers capability is active. */
  stripePayoutsReady: boolean;
  /**
   * Max food units this patron may hold at once (basket + open orders).
   * Null = use pantrySettings.defaultPatronCap.
   */
  patronCap: number | null;
  /** Pantry org seller — lists food, never receives Stripe payouts. */
  isPantrySeller: boolean;
  /** When true, patron cannot add to basket or checkout pantry orders. */
  pantryBlocked: boolean;
  /**
   * Allowlisted admins can opt out of the admin UI/role without leaving the allowlist.
   * Cleared when they re-enable admin or are removed from the allowlist.
   */
  adminOptOut: boolean;
  /** Registered FCM tokens for this user (never returned to clients). */
  pushDevices: PushDevice[];
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: string;
  sellerUserId: string;
  sellerEmail: string | null;
  sellerName: string | null;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition: "new" | "like_new" | "good" | "fair";
  locationLabel: string;
  status: ListingStatus;
  imageColor: string;
  /** Optional listing photo (`/uploads/…`). */
  imageUrl: string | null;
  /** Units available when pantry mode is on (1 for classic marketplace). */
  stockQty: number;
  /**
   * Max units of this item a patron may put in one basket.
   * Enforced with stock and the overall patron cap.
   */
  maxPerOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BasketItem {
  listingId: string;
  quantity: number;
  addedAt: string;
}

export interface Basket {
  userId: string;
  items: BasketItem[];
  updatedAt: string;
}

/** Platform pantry mode — admin-toggled. */
export interface PantrySettings {
  id: "default";
  /** When true: free handoffs, baskets + caps, sellers skip Stripe payouts. */
  enabled: boolean;
  /** Default max units per patron (basket + open pantry orders). */
  defaultPatronCap: number;
  /**
   * Basket lines hard-reserve stock on add. Set by migration after clearing
   * legacy soft-hold baskets.
   */
  hardReserveEnabled: boolean;
  /** Minutes idle before abandoned baskets release hard holds (0 = off). */
  basketHoldTtlMinutes: number;
  /** Available units at or below this flag as low stock. */
  lowStockThreshold: number;
  updatedAt: string;
}

/** Seller stock ledger entry. */
export interface StockAdjustment {
  id: string;
  listingId: string;
  sellerUserId: string;
  delta: number;
  /** Optional note; may be empty. */
  reason: string;
  previousQty: number;
  nextQty: number;
  createdAt: string;
}

export interface OrderItem {
  listingId: string;
  quantity: number;
  /** Title snapshot at checkout (basket may change later). */
  title: string;
}

export interface Order {
  id: string;
  /**
   * Primary listing (first line). Kept for Relai/marketplace compatibility.
   * Prefer `items` for display and stock.
   */
  listingId: string;
  /** Line items — pantry baskets are one order with many lines. */
  items: OrderItem[];
  buyerUserId: string;
  sellerUserId: string;
  priceCents: number;
  status: OrderStatus;
  /** Relai Exchange Zone chosen at checkout for the seller drop-off. */
  exchangeZoneId: string;
  exchangeZoneName: string;
  exchangeZoneAddress: string | null;
  /** Photo of the item in the compartment after drop-off (`/uploads/…`). */
  dropOffPhotoUrl: string | null;
  /** Relai Access order created when the seller drops off. */
  relaiOrderId: string | null;
  /** Open-handoff pick-up link from the Relai drop-off open. */
  pickupLinkCode: string | null;
  /**
   * Buyer pickup / escrow auto-release deadline (Relai link expiry or
   * drop-off + PICKUP_NO_SHOW_HOURS). After this, funds release to the seller.
   */
  pickupLinkExpiresAt: string | null;
  /** Auto-void deadline while waiting for seller accept. */
  sellerAcceptDeadlineAt: string | null;
  /** Auto-void deadline while waiting for seller drop-off. */
  sellerDropOffDeadlineAt: string | null;
  /**
   * Set when Relai confirms buyer pickup (webhook `order.completed` or
   * server poll of Relai order status). Required before escrow release for
   * `completedReason: "pickup"`. No-show releases do not use this.
   */
  relaiPickupVerifiedAt: string | null;
  /** Relai webhook event id that proved pickup (if via webhook). */
  relaiWebhookEventId: string | null;
  pickupVerifiedVia: PickupVerifiedVia | null;
  /** Platform PaymentIntent holding buyer funds until pickup or no-show. */
  stripePaymentIntentId: string | null;
  stripeTransferId: string | null;
  stripeRefundId: string | null;
  /** Last Connect transfer failure message (cleared on success). */
  transferLastError: string | null;
  paymentStatus: PaymentStatus;
  /** Snapshot of paymentStatus when a dispute opened (for restore on win). */
  paymentStatusBeforeDispute: PaymentStatus | null;
  stripeDisputeId: string | null;
  disputeStatus: DisputeStatus | null;
  /** Ops freeze: skips auto no-show / seller-timeout / stuck-transfer sweeps. */
  adminHold: boolean;
  /** Buyer/seller-opened platform dispute (item in locker / post-handoff issue). */
  platformDisputeReason: string | null;
  platformDisputeOpenedBy: string | null;
  platformDisputeOpenedAt: string | null;
  /** Set when status becomes completed. */
  completedReason: CompletedReason | null;
  cancelledReason: CancelledReason | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Favorite {
  userId: string;
  listingId: string;
  createdAt: string;
}

export interface Database {
  profiles: Profile[];
  listings: Listing[];
  orders: Order[];
  favorites: Favorite[];
  baskets: Basket[];
  pantrySettings: PantrySettings;
  stockAdjustments: StockAdjustment[];
  /** Recent Stripe webhook event ids (idempotency). */
  processedStripeEvents: string[];
  /** Recent Relai webhook event ids (idempotency). */
  processedRelaiEvents: string[];
}
