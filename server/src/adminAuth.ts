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
 * Sync allowlist → profile.roles.
 * Admin cannot be self-selected; it is granted/revoked only via ADMIN_USER_IDS / ADMIN_EMAILS.
 * Allowlisted admins are ops-only (no buyer/seller marketplace roles).
 */
export async function syncAdminRoleForUser(user: AuthUser): Promise<Profile> {
  const wantAdmin = isAdminAllowlisted(user);
  const ts = new Date().toISOString();
  let profile: Profile | undefined;

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    if (idx >= 0) {
      const current = db.profiles[idx]!;
      let roles: MarketplaceRole[];
      if (wantAdmin) {
        roles = ["admin"];
      } else {
        roles = current.roles.filter(
          (r): r is MarketplaceRole => r === "buyer" || r === "seller",
        );
      }
      profile = {
        ...current,
        email: user.email,
        name: user.name,
        roles,
        updatedAt: ts,
      };
      db.profiles[idx] = profile;
    } else {
      profile = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        roles: wantAdmin ? ["admin"] : [],
        bio: "",
        stripeAccountId: null,
        stripePayoutsReady: false,
        createdAt: ts,
        updatedAt: ts,
      };
      db.profiles.push(profile);
    }
  });

  return profile!;
}

export function userIsAdmin(user: AuthUser): boolean {
  if (isAdminAllowlisted(user)) return true;
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
 * Admin gate: Relai session + `admin` role (from allowlist), or `x-admin-key` for automation.
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
            "Admin role required. Add your Relai user id or email to ADMIN_USER_IDS / ADMIN_EMAILS.",
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
