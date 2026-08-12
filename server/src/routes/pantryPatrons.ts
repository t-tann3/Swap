import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { isPantryMode } from "../pantry.js";
import {
  parsePatronCsv,
  patronRosterSnapshot,
  removePatron,
  setPatronAllowlistEnabled,
  upsertPatronsFromRows,
} from "../pantryPatrons.js";
import {
  primaryPantryForUser,
  syncPantryAccessForUser,
} from "../pantryOrg.js";

export const pantryPatronsRouter = Router();

function requirePantryMode(
  res: { status: (n: number) => { json: (b: unknown) => void } },
): boolean {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Patron roster features require pantry mode.",
    });
    return false;
  }
  return true;
}

/** Owner (or staff) view of the neighbor allowlist + enforcement toggle. */
pantryPatronsRouter.get("/me/pantry/patrons", requireAuth, async (req, res) => {
  if (!requirePantryMode(res)) return;
  const user = req.user!;
  await syncPantryAccessForUser(user);
  const primary = primaryPantryForUser(user.userId);
  if (!primary) {
    res.json({
      pantry: null,
      role: null,
      patrons: [],
    });
    return;
  }
  const snap = patronRosterSnapshot(primary.pantry.id);
  res.json({
    pantry: snap?.pantry ?? null,
    role: primary.role,
    patrons: snap?.patrons ?? [],
  });
});

/** Owner toggles whether the roster is enforced for shopping. */
pantryPatronsRouter.put(
  "/me/pantry/patrons/settings",
  requireAuth,
  async (req, res) => {
    if (!requirePantryMode(res)) return;
    const parsed = z
      .object({ patronAllowlistEnabled: z.boolean() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        code: "invalid_body",
        message: "patronAllowlistEnabled (boolean) is required.",
      });
      return;
    }
    const user = req.user!;
    await syncPantryAccessForUser(user);
    try {
      const pantry = await setPatronAllowlistEnabled(
        user.userId,
        parsed.data.patronAllowlistEnabled,
      );
      res.json({
        pantry: {
          id: pantry.id,
          ownerUserId: pantry.ownerUserId,
          name: pantry.name,
          patronAllowlistEnabled: pantry.patronAllowlistEnabled,
        },
      });
    } catch (err) {
      const code = (err as Error).message;
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        code,
        message:
          code === "owner_required"
            ? "Only the pantry owner can change member access settings."
            : "Could not update settings.",
      });
    }
  },
);

/** Upload CSV text or structured rows of verified neighbors. */
pantryPatronsRouter.post(
  "/me/pantry/patrons/upload",
  requireAuth,
  async (req, res) => {
    if (!requirePantryMode(res)) return;
    const parsed = z
      .object({
        csv: z.string().max(2_000_000).optional(),
        rows: z
          .array(
            z.object({
              email: z.string().trim().min(3).max(200),
              firstName: z.string().trim().max(80).optional().nullable(),
              lastName: z.string().trim().max(80).optional().nullable(),
              phone: z.string().trim().max(40).optional().nullable(),
            }),
          )
          .max(10_000)
          .optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        code: "invalid_body",
        message: "Provide csv text or rows with email.",
      });
      return;
    }

    const rows =
      parsed.data.rows ??
      (parsed.data.csv ? parsePatronCsv(parsed.data.csv) : []);
    if (!rows.length) {
      res.status(400).json({
        code: "empty_roster",
        message: "No valid email rows found. Use a CSV with an email column.",
      });
      return;
    }

    const user = req.user!;
    await syncPantryAccessForUser(user);
    try {
      const result = await upsertPatronsFromRows(user.userId, rows);
      const primary = primaryPantryForUser(user.userId);
      const snap = primary
        ? patronRosterSnapshot(primary.pantry.id)
        : null;
      res.status(201).json({
        ...result,
        pantry: snap?.pantry ?? null,
        patrons: snap?.patrons ?? [],
      });
    } catch (err) {
      const code = (err as Error).message;
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        code,
        message:
          code === "owner_required"
            ? "Only the pantry owner can upload a member list."
            : "Could not upload roster.",
      });
    }
  },
);

pantryPatronsRouter.delete(
  "/me/pantry/patrons/:id",
  requireAuth,
  async (req, res) => {
    if (!requirePantryMode(res)) return;
    const user = req.user!;
    try {
      await removePatron(user.userId, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      const code = (err as Error).message;
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        code,
        message:
          code === "owner_required"
            ? "Only the pantry owner can remove members."
            : "Member not found.",
      });
    }
  },
);
