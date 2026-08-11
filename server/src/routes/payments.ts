import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { getDb, mutateDb } from "../db.js";
import {
  createListingPaymentIntent,
  ensureSellerConnectAccount,
  refreshSellerPayoutReadiness,
} from "../payments.js";
import {
  appBaseUrl,
  getStripe,
  paymentsEnabled,
  platformFeeBps,
  publishableKey,
} from "../stripe.js";
import { isPantryMode, pantryPublicConfig } from "../pantry.js";

export const paymentsRouter = Router();

paymentsRouter.get("/config", (_req, res) => {
  const pantry = pantryPublicConfig();
  const enabled = paymentsEnabled() && !pantry.pantryMode;
  res.json({
    enabled,
    /** When false, clients should hide prices and Stripe Connect (non-monetary mode). */
    showPrices: enabled,
    publishableKey: enabled ? publishableKey() : null,
    platformFeeBps: enabled ? platformFeeBps() : 0,
    ...pantry,
  });
});

paymentsRouter.get("/connect/status", requireAuth, async (req, res) => {
  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!paymentsEnabled() || isPantryMode() || profile?.isPantrySeller) {
    res.json({
      enabled: false,
      stripeAccountId: profile?.stripeAccountId ?? null,
      payoutsReady: true,
      pantryMode: isPantryMode(),
      isPantrySeller: Boolean(profile?.isPantrySeller),
    });
    return;
  }
  const payoutsReady = profile?.stripeAccountId
    ? await refreshSellerPayoutReadiness(user.userId)
    : false;
  const latest = getDb().profiles.find(p => p.userId === user.userId);
  res.json({
    enabled: true,
    stripeAccountId: latest?.stripeAccountId ?? null,
    payoutsReady,
  });
});

paymentsRouter.post("/connect/onboard", requireAuth, async (req, res) => {
  if (!paymentsEnabled()) {
    res.status(503).json({
      code: "payments_disabled",
      message: "Stripe is not configured on the server.",
    });
    return;
  }

  const user = req.user!;
  let profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile) {
    const ts = new Date().toISOString();
    profile = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      roles: ["seller"],
      bio: "",
      stripeAccountId: null,
      stripePayoutsReady: false,
      patronCap: null,
      isPantrySeller: false,
      pantryBlocked: false,
      adminOptOut: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await mutateDb(db => {
      db.profiles.push(profile!);
    });
  }

  if (!profile.roles.includes("seller")) {
    res.status(403).json({
      code: "seller_required",
      message: "Enable the Pantry role before setting up payouts.",
    });
    return;
  }

  try {
    const { accountId } = await ensureSellerConnectAccount(profile);
    const stripe = getStripe();
    const base = appBaseUrl();
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${base}/account?connect=refresh`,
      return_url: `${base}/account?connect=return`,
      type: "account_onboarding",
    });
    res.json({ url: link.url, stripeAccountId: accountId });
  } catch (err) {
    res.status(502).json({
      code: "connect_onboard_failed",
      message:
        err instanceof Error
          ? err.message
          : "Could not start Stripe Connect onboarding.",
    });
  }
});

paymentsRouter.post("/payment-intents", requireAuth, async (req, res) => {
  if (!paymentsEnabled()) {
    res.status(503).json({
      code: "payments_disabled",
      message: "Stripe is not configured on the server.",
    });
    return;
  }

  const parsed = z
    .object({ listingId: z.string().min(1) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: "listingId required." });
    return;
  }

  const user = req.user!;
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  if (!profile?.roles.includes("buyer")) {
    res.status(403).json({
      code: "buyer_required",
      message: "Neighbor role required to pay.",
    });
    return;
  }

  const listing = getDb().listings.find(l => l.id === parsed.data.listingId);
  if (!listing || listing.status !== "available") {
    res.status(409).json({
      code: "unavailable",
      message: "This item is not available for purchase.",
    });
    return;
  }
  if (listing.sellerUserId === user.userId) {
    res.status(400).json({
      code: "own_listing",
      message: "You cannot buy your own listing.",
    });
    return;
  }
  if (listing.priceCents <= 0) {
    res.status(400).json({
      code: "invalid_price",
      message: "Listing price must be greater than zero to charge.",
    });
    return;
  }

  try {
    const pi = await createListingPaymentIntent({
      listingId: listing.id,
      buyerUserId: user.userId,
      sellerUserId: listing.sellerUserId,
      priceCents: listing.priceCents,
      title: listing.title,
    });
    res.status(201).json({
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret,
      amount: pi.amount,
      currency: pi.currency,
    });
  } catch (err) {
    res.status(502).json({
      code: "payment_intent_failed",
      message:
        err instanceof Error ? err.message : "Could not create payment intent.",
    });
  }
});
