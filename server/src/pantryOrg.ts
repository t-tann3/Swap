import type { AuthUser } from "./auth.js";
import { getDb, mutateDb, newId } from "./db.js";
import type {
  Database,
  Pantry,
  PantryInvite,
  PantryMembership,
  PantryStaffRole,
  Profile,
} from "./types.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function splitName(name: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.slice(1).join(" ") || null,
  };
}

function displayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined || fallback || null;
}

export type InviteDetails = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

export function getPantryById(pantryId: string): Pantry | undefined {
  return getDb().pantries.find(p => p.id === pantryId);
}

export function getPantryByOwner(ownerUserId: string): Pantry | undefined {
  return getDb().pantries.find(p => p.ownerUserId === ownerUserId);
}

export function membershipFor(
  pantryId: string,
  userId: string,
): PantryMembership | undefined {
  return getDb().pantryMemberships.find(
    m => m.pantryId === pantryId && m.userId === userId,
  );
}

/** True if the user is owner or member of the pantry that owns this seller id. */
export function canActForSeller(actorUserId: string, sellerUserId: string): boolean {
  if (actorUserId === sellerUserId) return true;
  const pantry = getPantryByOwner(sellerUserId);
  if (!pantry) return false;
  return Boolean(membershipFor(pantry.id, actorUserId));
}

/** Canonical seller user ids this staff member can stock / fulfill for. */
export function sellerIdsForActor(actorUserId: string): string[] {
  const owned = getDb()
    .pantries.filter(p => p.ownerUserId === actorUserId)
    .map(p => p.ownerUserId);
  const memberOf = getDb()
    .pantryMemberships.filter(m => m.userId === actorUserId)
    .map(m => getPantryById(m.pantryId)?.ownerUserId)
    .filter((id): id is string => Boolean(id));
  return [...new Set([actorUserId, ...owned, ...memberOf])];
}

export function staffRoleForSeller(
  actorUserId: string,
  sellerUserId: string,
): PantryStaffRole | null {
  if (actorUserId === sellerUserId) {
    const pantry = getPantryByOwner(sellerUserId);
    if (!pantry) return "owner";
    return membershipFor(pantry.id, actorUserId)?.role ?? "owner";
  }
  const pantry = getPantryByOwner(sellerUserId);
  if (!pantry) return null;
  return membershipFor(pantry.id, actorUserId)?.role ?? null;
}

function ensureSellerRoleOnProfile(db: Database, user: AuthUser, ts: string): void {
  const idx = db.profiles.findIndex(p => p.userId === user.userId);
  if (idx < 0) {
    const profile: Profile = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      roles: ["seller", "buyer"],
      bio: "",
      stripeAccountId: null,
      stripePayoutsReady: false,
      patronCap: null,
      isPantrySeller: true,
      pantryBlocked: false,
      adminOptOut: false,
      pushDevices: [],
      createdAt: ts,
      updatedAt: ts,
    };
    db.profiles.push(profile);
    return;
  }
  const p = db.profiles[idx]!;
  if (!p.roles.includes("seller")) {
    p.roles = [...new Set([...p.roles, "seller" as const])];
  }
  p.isPantrySeller = true;
  p.email = user.email ?? p.email;
  p.name = user.name ?? p.name;
  p.updatedAt = ts;
}

/**
 * Create a pantry + owner membership for a seller if missing.
 * Call when someone enables the Pantry (seller) role.
 */
export async function ensureOwnerPantry(user: AuthUser): Promise<Pantry> {
  const existing = getPantryByOwner(user.userId);
  if (existing) {
    // Keep membership row in sync.
    const mem = membershipFor(existing.id, user.userId);
    if (!mem) {
      const ts = new Date().toISOString();
      const parts = splitName(user.name);
      await mutateDb(db => {
        db.pantryMemberships.push({
          id: newId("pmem"),
          pantryId: existing.id,
          userId: user.userId,
          role: "owner",
          email: user.email,
          name: user.name,
          firstName: parts.firstName,
          lastName: parts.lastName,
          phone: null,
          createdAt: ts,
          updatedAt: ts,
        });
      });
    }
    return existing;
  }

  const ts = new Date().toISOString();
  const pantry: Pantry = {
    id: newId("ptry"),
    ownerUserId: user.userId,
    name: user.name ? `${user.name}'s pantry` : "My pantry",
    patronAllowlistEnabled: false,
    createdAt: ts,
    updatedAt: ts,
  };
  const parts = splitName(user.name);
  await mutateDb(db => {
    ensureSellerRoleOnProfile(db, user, ts);
    db.pantries.push(pantry);
    db.pantryMemberships.push({
      id: newId("pmem"),
      pantryId: pantry.id,
      userId: user.userId,
      role: "owner",
      email: user.email,
      name: user.name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      phone: null,
      createdAt: ts,
      updatedAt: ts,
    });
  });
  return getPantryByOwner(user.userId)!;
}

/** Claim pending email invites for this signed-in user. */
export async function claimPendingInvites(user: AuthUser): Promise<number> {
  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) return 0;

  const pending = getDb().pantryInvites.filter(
    i => i.status === "pending" && i.email === email,
  );
  if (!pending.length) return 0;

  const ts = new Date().toISOString();
  await mutateDb(db => {
    ensureSellerRoleOnProfile(db, user, ts);
    for (const invite of pending) {
      const row = db.pantryInvites.find(i => i.id === invite.id);
      if (!row || row.status !== "pending") continue;
      row.status = "accepted";
      row.acceptedAt = ts;
      row.acceptedUserId = user.userId;
      row.updatedAt = ts;

      const already = db.pantryMemberships.some(
        m => m.pantryId === row.pantryId && m.userId === user.userId,
      );
      if (!already) {
        const fromInvite = {
          firstName: row.firstName,
          lastName: row.lastName,
        };
        const fromUser = splitName(user.name);
        const firstName = fromInvite.firstName || fromUser.firstName;
        const lastName = fromInvite.lastName || fromUser.lastName;
        db.pantryMemberships.push({
          id: newId("pmem"),
          pantryId: row.pantryId,
          userId: user.userId,
          role: "member",
          email: user.email,
          name: displayName(firstName, lastName, user.name),
          firstName,
          lastName,
          phone: row.phone,
          createdAt: ts,
          updatedAt: ts,
        });
      }
    }
  });
  return pending.length;
}

export async function syncPantryAccessForUser(user: AuthUser): Promise<{
  claimed: number;
  ownedPantry: Pantry | null;
}> {
  const claimed = await claimPendingInvites(user);
  // Lazy import avoids a circular dependency with pantryPatrons.ts.
  const { matchPatronsForUser } = await import("./pantryPatrons.js");
  await matchPatronsForUser(user);
  const profile = getDb().profiles.find(p => p.userId === user.userId);
  let ownedPantry: Pantry | null = null;
  if (profile?.roles.includes("seller")) {
    ownedPantry = await ensureOwnerPantry(user);
  }
  return { claimed, ownedPantry };
}

export function primaryPantryForUser(userId: string): {
  pantry: Pantry;
  role: PantryStaffRole;
} | null {
  const owned = getPantryByOwner(userId);
  if (owned) return { pantry: owned, role: "owner" };
  const mem = getDb().pantryMemberships.find(m => m.userId === userId);
  if (!mem) return null;
  const pantry = getPantryById(mem.pantryId);
  if (!pantry) return null;
  return { pantry, role: mem.role };
}

export function teamSnapshot(pantryId: string) {
  const pantry = getPantryById(pantryId);
  if (!pantry) return null;
  const members = getDb()
    .pantryMemberships.filter(m => m.pantryId === pantryId)
    .map(m => {
      const split = splitName(m.name);
      return {
        userId: m.userId,
        role: m.role,
        email: m.email,
        name: m.name,
        firstName: m.firstName || split.firstName,
        lastName: m.lastName || split.lastName,
        phone: m.phone,
        status: "accepted" as const,
        createdAt: m.createdAt,
      };
    })
    .sort((a, b) => {
      if (a.role === b.role) return a.createdAt.localeCompare(b.createdAt);
      return a.role === "owner" ? -1 : 1;
    });
  const invites = getDb()
    .pantryInvites.filter(i => i.pantryId === pantryId && i.status === "pending")
    .map(i => ({
      id: i.id,
      email: i.email,
      firstName: i.firstName,
      lastName: i.lastName,
      phone: i.phone,
      invitedByUserId: i.invitedByUserId,
      status: "invited" as const,
      createdAt: i.createdAt,
    }));
  return { pantry, members, invites };
}

export async function inviteByEmail(
  ownerUserId: string,
  emailRaw: string,
  details: InviteDetails = {},
): Promise<PantryInvite> {
  const email = normalizeEmail(emailRaw);
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("invalid_email"), { status: 400 });
  }

  const firstName = details.firstName?.trim() || null;
  const lastName = details.lastName?.trim() || null;
  const phone = details.phone?.trim() || null;

  const pantry = getPantryByOwner(ownerUserId);
  if (!pantry) {
    throw Object.assign(new Error("pantry_required"), { status: 403 });
  }
  const role = staffRoleForSeller(ownerUserId, pantry.ownerUserId);
  if (role !== "owner") {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }

  if (pantry.ownerUserId === ownerUserId) {
    const ownerProfile = getDb().profiles.find(p => p.userId === ownerUserId);
    if (ownerProfile?.email && normalizeEmail(ownerProfile.email) === email) {
      throw Object.assign(new Error("cannot_invite_self"), { status: 409 });
    }
  }

  const existingMember = getDb().pantryMemberships.find(
    m =>
      m.pantryId === pantry.id &&
      m.email &&
      normalizeEmail(m.email) === email,
  );
  if (existingMember) {
    throw Object.assign(new Error("already_member"), { status: 409 });
  }

  const existingInvite = getDb().pantryInvites.find(
    i =>
      i.pantryId === pantry.id &&
      i.status === "pending" &&
      i.email === email,
  );
  if (existingInvite) return existingInvite;

  const ts = new Date().toISOString();
  const invite: PantryInvite = {
    id: newId("pinv"),
    pantryId: pantry.id,
    email,
    firstName,
    lastName,
    phone,
    invitedByUserId: ownerUserId,
    status: "pending",
    createdAt: ts,
    updatedAt: ts,
    acceptedAt: null,
    acceptedUserId: null,
  };
  await mutateDb(db => {
    db.pantryInvites.push(invite);
  });
  return invite;
}

export async function revokeInvite(
  ownerUserId: string,
  inviteId: string,
): Promise<void> {
  const invite = getDb().pantryInvites.find(i => i.id === inviteId);
  if (!invite || invite.status !== "pending") {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }
  const pantry = getPantryById(invite.pantryId);
  if (!pantry || pantry.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }
  const ts = new Date().toISOString();
  await mutateDb(db => {
    const row = db.pantryInvites.find(i => i.id === inviteId)!;
    row.status = "revoked";
    row.updatedAt = ts;
  });
}

export async function removeMember(
  ownerUserId: string,
  memberUserId: string,
): Promise<void> {
  const pantry = getPantryByOwner(ownerUserId);
  if (!pantry || pantry.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }
  if (memberUserId === ownerUserId) {
    throw Object.assign(new Error("cannot_remove_owner"), { status: 409 });
  }
  const mem = membershipFor(pantry.id, memberUserId);
  if (!mem || mem.role === "owner") {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }
  await mutateDb(db => {
    db.pantryMemberships = db.pantryMemberships.filter(
      m => !(m.pantryId === pantry.id && m.userId === memberUserId),
    );
  });
}
