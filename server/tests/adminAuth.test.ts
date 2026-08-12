import { describe, expect, it, vi } from "vitest";

import {
  exclusivePersonaRoles,
  isAdminAllowlisted,
  parseAdminAllowlist,
  profileHasAdminRole,
  requireAdmin,
} from "../src/adminAuth.js";
import type { AuthUser } from "../src/auth.js";

vi.mock("../src/db.js", () => ({
  getDb: () => ({
    profiles: [
      {
        userId: "usr_admin",
        roles: ["admin"],
      },
      {
        userId: "usr_buyer",
        roles: ["buyer"],
      },
    ],
  }),
  mutateDb: async () => undefined,
}));

vi.mock("../src/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../src/auth.js")>(
    "../src/auth.js",
  );
  return {
    ...actual,
    requireAuth: (
      req: { user?: AuthUser; headers: Record<string, string> },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        res.status(401).json({ code: "unauthorized" });
        return;
      }
      const token = auth.slice("Bearer ".length);
      if (token === "admin") {
        req.user = {
          userId: "usr_admin",
          email: "admin@example.com",
          name: "Admin",
        };
      } else if (token === "buyer") {
        req.user = {
          userId: "usr_buyer",
          email: "buyer@example.com",
          name: "Buyer",
        };
      } else {
        res.status(401).json({ code: "unauthorized" });
        return;
      }
      next();
    },
  };
});

function mockRes() {
  const state: { statusCode?: number; body?: unknown } = {};
  return {
    state,
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
}

describe("admin gates", () => {
  it("parses allowlist tokens", () => {
    process.env.ADMIN_USER_IDS = "usr_a, usr_b";
    process.env.ADMIN_EMAILS = "Ops@Example.com";
    expect(parseAdminAllowlist()).toEqual([
      "usr_a",
      "usr_b",
      "ops@example.com",
    ]);
  });

  it("matches allowlisted users", () => {
    process.env.ADMIN_USER_IDS = "usr_admin";
    process.env.ADMIN_EMAILS = "";
    expect(
      isAdminAllowlisted({
        userId: "usr_admin",
        email: "x@y.com",
        name: null,
      }),
    ).toBe(true);
    expect(
      isAdminAllowlisted({
        userId: "usr_other",
        email: "x@y.com",
        name: null,
      }),
    ).toBe(false);
  });

  it("detects admin role on profile", () => {
    expect(profileHasAdminRole({ roles: ["admin"] } as never)).toBe(true);
    expect(profileHasAdminRole({ roles: ["buyer"] } as never)).toBe(false);
  });

  it("keeps personas exclusive and never stacks admin", () => {
    expect(exclusivePersonaRoles(["buyer"], true)).toEqual(["buyer"]);
    expect(exclusivePersonaRoles(["seller"], true)).toEqual(["seller"]);
    expect(exclusivePersonaRoles(["admin"], true)).toEqual(["admin"]);
    expect(exclusivePersonaRoles(["buyer", "admin"], true)).toEqual([]);
    expect(exclusivePersonaRoles(["admin"], false)).toEqual([]);
  });

  it("allows x-admin-key without Relai session", async () => {
    process.env.ADMIN_API_KEY = "secret-admin";
    process.env.ADMIN_USER_IDS = "";
    process.env.ADMIN_EMAILS = "";

    const res = mockRes();
    let nextCalled = false;
    const req = {
      header: (name: string) =>
        name.toLowerCase() === "x-admin-key" ? "secret-admin" : undefined,
      headers: {},
    };

    await new Promise<void>(resolve => {
      requireAdmin(req as never, res as never, () => {
        nextCalled = true;
        resolve();
      });
      // requireAdmin may sync via requireAuth path; if key matches it calls next sync.
      if (nextCalled) resolve();
      setTimeout(resolve, 20);
    });

    expect(nextCalled).toBe(true);
    expect(res.state.statusCode).toBeUndefined();
  });

  it("rejects missing admin credentials", async () => {
    process.env.ADMIN_API_KEY = "secret-admin";
    process.env.ADMIN_USER_IDS = "usr_admin";
    process.env.ADMIN_EMAILS = "";

    const res = mockRes();
    let nextCalled = false;
    const req = {
      header: () => undefined,
      headers: { authorization: "Bearer buyer" },
      user: undefined as AuthUser | undefined,
    };

    await new Promise<void>(resolve => {
      requireAdmin(req as never, res as never, () => {
        nextCalled = true;
        resolve();
      });
      setTimeout(resolve, 50);
    });

    expect(nextCalled).toBe(false);
    expect(res.state.statusCode).toBe(403);
  });
});
