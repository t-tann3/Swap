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

async function resolveRelaiUser(
  token: string,
): Promise<{ user: AuthUser } | { errorStatus: number; message: string }> {
  const publishableKey = process.env.RELAI_PUBLISHABLE_KEY;

  if (!publishableKey?.startsWith("pk_")) {
    return {
      errorStatus: 500,
      message: "Server missing RELAI_PUBLISHABLE_KEY.",
    };
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
        const errBody = (await response.json()) as {
          code?: string;
          message?: string;
        };
        detail = errBody.code ? ` (${errBody.code})` : "";
      } catch {
        // ignore
      }
      return {
        errorStatus: 401,
        message:
          response.status === 401
            ? `Relai session is invalid or expired${detail}. Sign out and sign in again.`
            : `Relai verification failed (${response.status})${detail}.`,
      };
    }

    const me = (await response.json()) as {
      user_id: string;
      email: string | null;
      name: string | null;
    };

    return {
      user: {
        userId: me.user_id,
        email: me.email,
        name: me.name,
      },
    };
  } catch {
    return {
      errorStatus: 503,
      message: "Could not verify session with Relai.",
    };
  }
}

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
  const result = await resolveRelaiUser(token);
  if ("errorStatus" in result) {
    res.status(result.errorStatus).json({
      code:
        result.errorStatus === 503
          ? "relai_unreachable"
          : result.errorStatus === 500
            ? "server_misconfigured"
            : "unauthorized",
      message: result.message,
    });
    return;
  }
  req.user = result.user;
  next();
}

/** Attach user when a bearer token is present; otherwise continue anonymously. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    next();
    return;
  }
  const token = header.slice("bearer ".length).trim();
  const result = await resolveRelaiUser(token);
  if ("user" in result) {
    req.user = result.user;
  }
  next();
}
