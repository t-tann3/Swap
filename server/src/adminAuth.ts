import type { NextFunction, Request, Response } from "express";

import { requireAuth, type AuthUser } from "./auth.js";
import { getDb, mutateDb } from "./db.js";
import type { MarketplaceRole, Profile } from "./types.js";

/** Comma-separated Relai user ids and/or emails granted the admin role. */
export function parseAdminAllowlist(): string[] {
  const raw = [
    process.env.ADMIN_USER_IDS ?? "",
    process.env.ADMIN_EMAILS ?? "",
  ].join(",");
  return raw
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminAllowlisted(user: AuthUser): boolean {
  const tokens = parseAdminAllowlist();
  if (!tokens.length) return false;
  if (tokens.includes(user.userId.toLowerCase())) return true;
  if (user.email && tokens.includes(user.email.toLowerCase())) return true;
  return false;
}

export function profileHasAdminRole(profile: Profile | undefined | null): boolean {
  return Boolean(profile?.roles.includes("admin"));
}

/**
 * Normalize to exactly one exclusive persona: buyer | seller | admin.
 * Admin is never stacked on Neighbor/Pantry. Stacked legacy roles are cleared
 * so the user re-picks on onboarding (allowlisted users see Admin there).
 */
export function exclusivePersonaRoles(
  roles: MarketplaceRole[],
  onAllowlist: boolean,
): MarketplaceRole[] {
  const buyer = roles.includes("buyer");
  const seller = roles.includes("seller");
  const admin = roles.includes("admin") && onAllowlist;

  if (buyer && !seller && !admin) return ["buyer"];
  if (seller && !buyer && !admin) return ["seller"];
  if (admin && !buyer && !seller) return ["admin"];
  // Dual marketplace, stacked admin+marketplace, or admin without allowlist → re-choose.
  return [];
}

/**
 * Sync allowlist + exclusive personas onto the profile.
 * Does not auto-grant Admin onto Neighbor/Pantry accounts.
 */
export async function syncAdminRoleForUser(user: AuthUser): Promise<Profile> {
  const onAllowlist = isAdminAllowlisted(user);
  const ts = new Date().toISOString();
  let profile: Profile | undefined;

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    if (idx >= 0) {
      const current = db.profiles[idx]!;
      const roles = exclusivePersonaRoles(current.roles, onAllowlist);
      profile = {
        ...current,
        email: user.email,
        name: user.name,
        roles,
        // Unused for stacking; kept for backward-compatible field.
        adminOptOut: false,
        updatedAt: ts,
      };
      db.profiles[idx] = profile;
    } else {
      profile = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        roles: [],
        bio: "",
        stripeAccountId: null,
        stripePayoutsReady: false,
        patronCap: null,
        isPantrySeller: false,
        pantryBlocked: false,
        adminOptOut: false,
        pushDevices: [],
        createdAt: ts,
        updatedAt: ts,
      };
      db.profiles.push(profile);
    }
  });

  return profile!;
}

/** Profile JSON for clients, including whether they may pick Admin account type. */
export function profileClientPayload(user: AuthUser, profile: Profile) {
  const { pushDevices: _pushDevices, ...safe } = profile;
  return {
    ...safe,
    adminEligible: isAdminAllowlisted(user),
  };
}

export function userIsAdmin(user: AuthUser): boolean {
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  return profileHasAdminRole(profile);
}

/** Optional machine key for cron/scripts (not a substitute for the admin role in-app). */
function adminApiKeyMatches(req: Request): boolean {
  const configured = process.env.ADMIN_API_KEY?.trim();
  if (!configured) return false;
  return req.header("x-admin-key")?.trim() === configured;
}

/**
 * Admin gate: Relai session + exclusive `admin` role, or `x-admin-key` for automation.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (adminApiKeyMatches(req)) {
    next();
    return;
  }

  void requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    void (async () => {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          code: "unauthorized",
          message: "Missing authenticated user.",
        });
        return;
      }
      const profile = await syncAdminRoleForUser(user);
      if (!profileHasAdminRole(profile)) {
        res.status(403).json({
          code: "admin_required",
          message:
            "Admin account required. Sign in and choose Admin on the account type screen (allowlisted emails only).",
        });
        return;
      }
      next();
    })().catch(next);
  });
}

export function adminApiConfigured(): boolean {
  return parseAdminAllowlist().length > 0 || Boolean(process.env.ADMIN_API_KEY?.trim());
}
