export type MarketplaceRole = "buyer" | "seller" | "admin";

export type ListingStatus =
  | "draft"
  | "available"
  | "reserved"
  | "sold"
  | "cancelled";

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
  /** Relai Exchange Zone compartment size (S/M/L). Required. */
  compartmentSize: "S" | "M" | "L";
  condition: ItemCondition;
  locationLabel: string;
  status: ListingStatus;
  imageColor: string;
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
  exchangeZoneId: string;
  exchangeZoneName: string;
  exchangeZoneAddress: string | null;
  compartmentSize?: "S" | "M" | "L";
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
  category:
    | "Food"
    | "Books"
    | "Clothing"
    | "Electronics"
    | "Home"
    | "Kids"
    | "Garden"
    | "General";
  compartmentSize: "S" | "M" | "L";
  condition?: ItemCondition;
  locationLabel?: string;
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
}
