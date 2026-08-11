export type MarketplaceRole = "buyer" | "seller" | "admin";

export type OrderStatus =
  | "pending_accept"
  | "accepted"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

export type CompletedReason = "pickup" | "no_show" | "admin_release";

export type ItemCondition = "new" | "like_new" | "good" | "fair";

export type PaymentStatus =
  | "none"
  | "authorized"
  | "captured"
  | "transferred"
  | "cancelled"
  | "refunded"
  | "disputed";

export interface UserProfile {
  userId: string;
  email: string | null;
  name: string | null;
  roles: MarketplaceRole[];
  bio: string;
  stripeAccountId?: string | null;
  stripePayoutsReady?: boolean;
  patronCap?: number | null;
  isPantrySeller?: boolean;
  pantryBlocked?: boolean;
  adminOptOut?: boolean;
  /** True when this Relai user is on ADMIN_* allowlist (can toggle admin on). */
  adminEligible?: boolean;
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
  condition: ItemCondition;
  locationLabel: string;
  status: string;
  imageColor: string;
  imageUrl?: string | null;
  stockQty?: number;
  /** Max of this item a patron may put in one basket. */
  maxPerOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  listingId: string;
  quantity: number;
  title: string;
  listing?: Listing | null;
}

export interface Order {
  id: string;
  listingId: string;
  items?: OrderItem[];
  buyerUserId: string;
  sellerUserId: string;
  priceCents: number;
  status: OrderStatus;
  exchangeZoneId: string;
  exchangeZoneName: string;
  exchangeZoneAddress: string | null;
  dropOffPhotoUrl?: string | null;
  relaiOrderId: string | null;
  pickupLinkCode: string | null;
  pickupLinkExpiresAt: string | null;
  sellerAcceptDeadlineAt?: string | null;
  sellerDropOffDeadlineAt?: string | null;
  relaiPickupVerifiedAt?: string | null;
  relaiWebhookEventId?: string | null;
  pickupVerifiedVia?: "webhook" | "poll" | null;
  stripePaymentIntentId?: string | null;
  stripeTransferId?: string | null;
  stripeRefundId?: string | null;
  transferLastError?: string | null;
  paymentStatus?: PaymentStatus;
  stripeDisputeId?: string | null;
  disputeStatus?: string | null;
  adminHold?: boolean;
  platformDisputeReason?: string | null;
  platformDisputeOpenedBy?: string | null;
  platformDisputeOpenedAt?: string | null;
  completedReason?: CompletedReason | null;
  cancelledReason?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  listing?: Listing | null;
}

export interface CreateListingInput {
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition?: ItemCondition;
  locationLabel?: string;
  imageUrl?: string | null;
  stockQty?: number;
  maxPerOrder?: number;
}

export interface CheckoutExchangeZone {
  exchangeZoneId: string;
  exchangeZoneName: string;
  exchangeZoneAddress: string | null;
  paymentIntentId?: string;
}

export interface DropOffPayload {
  relaiOrderId: string;
  pickupLinkCode: string;
  pickupLinkExpiresAt: string | null;
  dropOffPhotoUrl?: string | null;
}
