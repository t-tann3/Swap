import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { isPantryMode } from "../pantry.js";
import {
  inviteByEmail,
  primaryPantryForUser,
  removeMember,
  revokeInvite,
  syncPantryAccessForUser,
  teamSnapshot,
} from "../pantryOrg.js";

export const pantryTeamRouter = Router();

function requirePantryMode(
  res: { status: (n: number) => { json: (b: unknown) => void } },
): boolean {
  if (!isPantryMode()) {
    res.status(409).json({
      code: "pantry_disabled",
      message: "Pantry team features require pantry mode.",
    });
    return false;
  }
  return true;
}

/** Current pantry team for the signed-in user (owned or joined). */
pantryTeamRouter.get("/me/pantry", requireAuth, async (req, res) => {
  if (!requirePantryMode(res)) return;
  const user = req.user!;
  await syncPantryAccessForUser(user);
  const primary = primaryPantryForUser(user.userId);
  if (!primary) {
    res.json({
      pantry: null,
      role: null,
      members: [],
      invites: [],
    });
    return;
  }
  const snap = teamSnapshot(primary.pantry.id);
  res.json({
    pantry: snap?.pantry ?? null,
    role: primary.role,
    members: snap?.members ?? [],
    invites: snap?.invites ?? [],
  });
});

/** Owner invites a member by email (pending until they sign in). */
pantryTeamRouter.post("/me/pantry/invites", requireAuth, async (req, res) => {
  if (!requirePantryMode(res)) return;
  const parsed = z
    .object({
      email: z.string().trim().email().max(200),
      firstName: z.string().trim().max(80).optional().nullable(),
      lastName: z.string().trim().max(80).optional().nullable(),
      phone: z.string().trim().max(40).optional().nullable(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_body",
      message: "A valid email is required.",
    });
    return;
  }

  const user = req.user!;
  await syncPantryAccessForUser(user);
  try {
    const invite = await inviteByEmail(user.userId, parsed.data.email, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone,
    });
    res.status(201).json(invite);
  } catch (err) {
    const code = (err as Error).message;
    const status = (err as { status?: number }).status ?? 500;
    const messages: Record<string, string> = {
      invalid_email: "Enter a valid email address.",
      pantry_required: "Enable the Pantry role before inviting members.",
      owner_required: "Only the pantry owner can invite members.",
      cannot_invite_self: "You cannot invite yourself.",
      already_member: "That person is already on this pantry.",
    };
    res.status(status).json({
      code,
      message: messages[code] ?? "Could not send invite.",
    });
  }
});

pantryTeamRouter.delete(
  "/me/pantry/invites/:id",
  requireAuth,
  async (req, res) => {
    if (!requirePantryMode(res)) return;
    const user = req.user!;
    try {
      await revokeInvite(user.userId, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      const code = (err as Error).message;
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        code,
        message:
          code === "owner_required"
            ? "Only the pantry owner can revoke invites."
            : "Invite not found.",
      });
    }
  },
);

pantryTeamRouter.delete(
  "/me/pantry/members/:userId",
  requireAuth,
  async (req, res) => {
    if (!requirePantryMode(res)) return;
    const user = req.user!;
    try {
      await removeMember(user.userId, String(req.params.userId));
      res.json({ ok: true });
    } catch (err) {
      const code = (err as Error).message;
      const status = (err as { status?: number }).status ?? 500;
      const messages: Record<string, string> = {
        owner_required: "Only the pantry owner can remove members.",
        cannot_remove_owner: "The owner cannot be removed.",
        not_found: "Member not found.",
      };
      res.status(status).json({
        code,
        message: messages[code] ?? "Could not remove member.",
      });
    }
  },
);
