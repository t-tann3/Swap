export type MarketplaceRole = "buyer" | "seller";

export type OrderStatus =
  | "pending_accept"
  | "accepted"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

export type CompletedReason = "pickup" | "no_show";

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
  condition: ItemCondition;
  locationLabel: string;
  status: string;
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
  relaiOrderId: string | null;
  pickupLinkCode: string | null;
  pickupLinkExpiresAt: string | null;
  relaiPickupVerifiedAt?: string | null;
  relaiWebhookEventId?: string | null;
  pickupVerifiedVia?: "webhook" | "poll" | null;
  stripePaymentIntentId?: string | null;
  stripeTransferId?: string | null;
  stripeRefundId?: string | null;
  paymentStatus?: PaymentStatus;
  completedReason?: CompletedReason | null;
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
