import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth.js";
import { mutateDb } from "../db.js";
import { upsertPushDevice } from "../push.js";
import type { Profile } from "../types.js";

export const pushRouter = Router();

const registerSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(["ios", "android"]),
});

const unregisterSchema = z.object({
  token: z.string().min(10).max(4096),
});

function ensureProfileShell(
  user: { userId: string; email: string | null; name: string | null },
  existing: Profile | null,
  ts: string,
): Profile {
  if (existing) return existing;
  return {
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
}

pushRouter.post("/me/push-token", requireAuth, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }

  const user = req.user!;
  const ts = new Date().toISOString();

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    const current = idx >= 0 ? db.profiles[idx]! : null;
    const profile = ensureProfileShell(user, current, ts);
    profile.email = user.email;
    profile.name = user.name;
    profile.pushDevices = upsertPushDevice(profile.pushDevices, {
      token: parsed.data.token,
      platform: parsed.data.platform,
      updatedAt: ts,
    });
    profile.updatedAt = ts;
    if (idx >= 0) db.profiles[idx] = profile;
    else db.profiles.push(profile);
  });

  res.json({ ok: true });
});

pushRouter.delete("/me/push-token", requireAuth, async (req, res) => {
  const parsed = unregisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_body", message: parsed.error.message });
    return;
  }

  const user = req.user!;
  const ts = new Date().toISOString();

  await mutateDb(db => {
    const idx = db.profiles.findIndex(p => p.userId === user.userId);
    if (idx < 0) return;
    const profile = db.profiles[idx]!;
    profile.pushDevices = (profile.pushDevices ?? []).filter(
      d => d.token !== parsed.data.token,
    );
    profile.updatedAt = ts;
  });

  res.json({ ok: true });
});
