/** buyer/seller are self-serve; admin is allowlist-granted only. */
export type MarketplaceRole = "buyer" | "seller" | "admin";

export type ListingStatus =
  | "draft"
  | "available"
  | "reserved"
  | "sold"
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
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  listingId: string;
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
  /** Recent Stripe webhook event ids (idempotency). */
  processedStripeEvents: string[];
  /** Recent Relai webhook event ids (idempotency). */
  processedRelaiEvents: string[];
}
