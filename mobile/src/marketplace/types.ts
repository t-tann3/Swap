export type MarketplaceRole = "buyer" | "seller" | "admin";

export type ListingStatus =
  | "draft"
  | "available"
  | "reserved"
  | "sold"
  | "out_of_stock"
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
  /** Held for the seller until they finish payout setup. */
  | "credited"
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
  adminEligible?: boolean;
}

export interface Listing {
  id: string;
  sellerUserId: string;
  sellerEmail: string | null;
  sellerName: string | null;
  createdByUserId?: string | null;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  condition: ItemCondition;
  locationLabel: string;
  status: ListingStatus;
  imageColor: string;
  imageUrl?: string | null;
  stockQty?: number;
  maxPerOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export type PantryStaffRole = "owner" | "member";

export interface PantryTeamMember {
  userId: string;
  role: PantryStaffRole;
  email: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: "accepted";
  createdAt: string;
}

export interface PantryTeamInvite {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  invitedByUserId: string;
  status: "invited";
  createdAt: string;
}

export interface PantryTeam {
  pantry: { id: string; ownerUserId: string; name: string } | null;
  role: PantryStaffRole | null;
  members: PantryTeamMember[];
  invites: PantryTeamInvite[];
}

export type PantryPatronStatus = "listed" | "matched";

export interface PantryPatronRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  userId: string | null;
  status: PantryPatronStatus;
  createdAt: string;
  matchedAt: string | null;
}

export interface PantryPatronRoster {
  pantry: {
    id: string;
    ownerUserId: string;
    name: string;
    patronAllowlistEnabled: boolean;
  } | null;
  role: PantryStaffRole | null;
  patrons: PantryPatronRow[];
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
  acceptedByUserId?: string | null;
  acceptedByName?: string | null;
  droppedOffByUserId?: string | null;
  droppedOffByName?: string | null;
  completedReason?: CompletedReason | null;
  cancelledReason?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  listing?: Listing | null;
  /** Enriched from buyer profile for seller/ops views. */
  buyerEmail?: string | null;
}

export interface CreateListingInput {
  title: string;
  description: string;
  priceCents: number;
  category: import("./categories").ListingCategory;
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
