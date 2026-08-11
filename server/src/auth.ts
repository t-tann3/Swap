import type { NextFunction, Request, Response } from "express";

export interface AuthUser {
  userId: string;
  email: string | null;
  name: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const RELAI_API = "https://access.relai.us/api/v1";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ code: "unauthorized", message: "Missing bearer token." });
    return;
  }

  const token = header.slice("bearer ".length).trim();
  const publishableKey = process.env.RELAI_PUBLISHABLE_KEY;

  if (!publishableKey?.startsWith("pk_")) {
    res.status(500).json({
      code: "server_misconfigured",
      message: "Server missing RELAI_PUBLISHABLE_KEY.",
    });
    return;
  }

  try {
    const response = await fetch(`${RELAI_API}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Relai-Key": publishableKey,
      },
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errBody = (await response.json()) as { code?: string; message?: string };
        detail = errBody.code ? ` (${errBody.code})` : "";
      } catch {
        // ignore
      }
      res.status(401).json({
        code: "unauthorized",
        message:
          response.status === 401
            ? `Relai session is invalid or expired${detail}. Sign out and sign in again.`
            : `Relai verification failed (${response.status})${detail}.`,
      });
      return;
    }

    const me = (await response.json()) as {
      user_id: string;
      email: string | null;
      name: string | null;
    };

    req.user = {
      userId: me.user_id,
      email: me.email,
      name: me.name,
    };
    next();
  } catch {
    res.status(503).json({
      code: "relai_unreachable",
      message: "Could not verify session with Relai.",
    });
  }
}
