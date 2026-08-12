import type { AuthUser } from "./auth.js";
import { getDb, mutateDb, newId } from "./db.js";
import {
  getPantryByOwner,
  membershipFor,
} from "./pantryOrg.js";
import type { Pantry, PantryPatron } from "./types.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Staff of a pantry may always shop/view that pantry's shelf. */
export function isPantryStaff(pantryId: string, userId: string): boolean {
  return Boolean(membershipFor(pantryId, userId));
}

export function activePatronForEmail(
  pantryId: string,
  emailRaw: string | null | undefined,
): PantryPatron | undefined {
  const email = emailRaw ? normalizeEmail(emailRaw) : "";
  if (!email) return undefined;
  return getDb().pantryPatrons.find(
    p =>
      p.pantryId === pantryId &&
      p.status !== "removed" &&
      p.email === email,
  );
}

export function activePatronForUser(
  pantryId: string,
  userId: string,
): PantryPatron | undefined {
  return getDb().pantryPatrons.find(
    p =>
      p.pantryId === pantryId &&
      p.status !== "removed" &&
      p.userId === userId,
  );
}

/**
 * Whether a neighbor may shop a pantry when allowlist enforcement is on.
 * When enforcement is off, always true. Staff always allowed.
 */
export function canShopPantry(
  pantry: Pantry | undefined | null,
  user: { userId: string; email: string | null } | null | undefined,
): boolean {
  if (!pantry) return true;
  if (!pantry.patronAllowlistEnabled) return true;
  if (!user) return false;
  if (isPantryStaff(pantry.id, user.userId)) return true;
  if (activePatronForUser(pantry.id, user.userId)) return true;
  if (activePatronForEmail(pantry.id, user.email)) return true;
  return false;
}

export function assertCanShopSeller(
  sellerUserId: string,
  user: { userId: string; email: string | null },
): void {
  const pantry = getPantryByOwner(sellerUserId);
  if (!canShopPantry(pantry, user)) {
    throw Object.assign(new Error("not_pantry_member"), { status: 403 });
  }
}

/** Link signed-in neighbor emails to roster rows across all pantries. */
export async function matchPatronsForUser(user: AuthUser): Promise<number> {
  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) return 0;

  const pending = getDb().pantryPatrons.filter(
    p => p.status !== "removed" && p.email === email && p.userId !== user.userId,
  );
  if (!pending.length) return 0;

  const ts = new Date().toISOString();
  await mutateDb(db => {
    for (const row of pending) {
      const live = db.pantryPatrons.find(p => p.id === row.id);
      if (!live || live.status === "removed") continue;
      live.userId = user.userId;
      live.status = "matched";
      live.matchedAt = ts;
      live.updatedAt = ts;
    }
  });
  return pending.length;
}

export type PatronUploadRow = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

export function parsePatronCsv(csvText: string): PatronUploadRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headerCells = split(lines[0]!).map(h =>
    h.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const looksLikeHeader = headerCells.some(h =>
    ["email", "emailaddress", "firstname", "lastname", "phone", "phonenumber"].includes(
      h,
    ),
  );

  let emailIdx = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  let phoneIdx = -1;
  let start = 0;

  if (looksLikeHeader) {
    emailIdx = headerCells.findIndex(h => h === "email" || h === "emailaddress");
    if (emailIdx < 0) emailIdx = 0;
    firstIdx = headerCells.findIndex(
      h => h === "firstname" || h === "first" || h === "givenname",
    );
    lastIdx = headerCells.findIndex(
      h => h === "lastname" || h === "last" || h === "surname" || h === "familyname",
    );
    phoneIdx = headerCells.findIndex(
      h => h === "phone" || h === "phonenumber" || h === "mobile" || h === "cell",
    );
    start = 1;
  }

  const rows: PatronUploadRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]!);
    const email = (cells[emailIdx] ?? "").trim();
    if (!email) continue;
    rows.push({
      email,
      firstName: firstIdx >= 0 ? cells[firstIdx] || null : null,
      lastName: lastIdx >= 0 ? cells[lastIdx] || null : null,
      phone: phoneIdx >= 0 ? cells[phoneIdx] || null : null,
    });
  }
  return rows;
}

export async function upsertPatronsFromRows(
  ownerUserId: string,
  rows: PatronUploadRow[],
): Promise<{ added: number; updated: number; skipped: number }> {
  const pantry = getPantryByOwner(ownerUserId);
  if (!pantry || pantry.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const ts = new Date().toISOString();

  await mutateDb(db => {
    for (const row of rows) {
      const email = normalizeEmail(row.email);
      if (!email || !isValidEmail(email)) {
        skipped++;
        continue;
      }
      const firstName = row.firstName?.trim() || null;
      const lastName = row.lastName?.trim() || null;
      const phone = row.phone?.trim() || null;

      const existing = db.pantryPatrons.find(
        p => p.pantryId === pantry.id && p.email === email,
      );
      if (existing) {
        existing.firstName = firstName ?? existing.firstName;
        existing.lastName = lastName ?? existing.lastName;
        existing.phone = phone ?? existing.phone;
        if (existing.status === "removed") {
          existing.status = existing.userId ? "matched" : "listed";
        }
        existing.updatedAt = ts;
        updated++;
        continue;
      }

      const matchedProfile = db.profiles.find(
        p => p.email && normalizeEmail(p.email) === email,
      );
      const patron: PantryPatron = {
        id: newId("ppat"),
        pantryId: pantry.id,
        email,
        firstName,
        lastName,
        phone,
        userId: matchedProfile?.userId ?? null,
        status: matchedProfile ? "matched" : "listed",
        uploadedByUserId: ownerUserId,
        createdAt: ts,
        updatedAt: ts,
        matchedAt: matchedProfile ? ts : null,
      };
      db.pantryPatrons.push(patron);
      added++;
    }
  });

  return { added, updated, skipped };
}

export async function removePatron(
  ownerUserId: string,
  patronId: string,
): Promise<void> {
  const pantry = getPantryByOwner(ownerUserId);
  if (!pantry || pantry.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }
  const row = getDb().pantryPatrons.find(
    p => p.id === patronId && p.pantryId === pantry.id,
  );
  if (!row || row.status === "removed") {
    throw Object.assign(new Error("not_found"), { status: 404 });
  }
  const ts = new Date().toISOString();
  await mutateDb(db => {
    const live = db.pantryPatrons.find(p => p.id === patronId)!;
    live.status = "removed";
    live.updatedAt = ts;
  });
}

export async function setPatronAllowlistEnabled(
  ownerUserId: string,
  enabled: boolean,
): Promise<Pantry> {
  const pantry = getPantryByOwner(ownerUserId);
  if (!pantry || pantry.ownerUserId !== ownerUserId) {
    throw Object.assign(new Error("owner_required"), { status: 403 });
  }
  const ts = new Date().toISOString();
  await mutateDb(db => {
    const live = db.pantries.find(p => p.id === pantry.id)!;
    live.patronAllowlistEnabled = enabled;
    live.updatedAt = ts;
  });
  return getPantryByOwner(ownerUserId)!;
}

export function patronRosterSnapshot(pantryId: string) {
  const pantry = getDb().pantries.find(p => p.id === pantryId);
  if (!pantry) return null;
  const patrons = getDb()
    .pantryPatrons.filter(p => p.pantryId === pantryId && p.status !== "removed")
    .map(p => ({
      id: p.id,
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      userId: p.userId,
      status: p.status === "matched" ? ("matched" as const) : ("listed" as const),
      createdAt: p.createdAt,
      matchedAt: p.matchedAt,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  return {
    pantry: {
      id: pantry.id,
      ownerUserId: pantry.ownerUserId,
      name: pantry.name,
      patronAllowlistEnabled: pantry.patronAllowlistEnabled,
    },
    patrons,
  };
}

/** Filter listings so neighbors only see pantries they may shop. */
export function filterListingsForPatronAccess<T extends { sellerUserId: string }>(
  listings: T[],
  user: { userId: string; email: string | null } | null | undefined,
): T[] {
  const db = getDb();
  const pantryByOwner = new Map(
    db.pantries.map(p => [p.ownerUserId, p] as const),
  );
  return listings.filter(listing => {
    const pantry = pantryByOwner.get(listing.sellerUserId);
    return canShopPantry(pantry, user);
  });
}
