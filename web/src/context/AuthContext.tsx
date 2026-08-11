"use client";

import type { Me } from "@relai-team/access-sdk";
import { RelaiApiError } from "@relai-team/access-sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getRelai, initRelai } from "../lib/relai/client";

type AuthStatus = "booting" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  me: Me | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  lastError: { code?: string; message: string } | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toError(err: unknown): { code?: string; message: string } {
  if (err instanceof RelaiApiError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: "Something went wrong" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [me, setMe] = useState<Me | null>(null);
  const [lastError, setLastError] = useState<{
    code?: string;
    message: string;
  } | null>(null);

  const refreshMe = useCallback(async () => {
    const relai = getRelai();
    if (!relai.auth.isSignedIn) {
      setMe(null);
      setStatus("signedOut");
      return;
    }
    const next = await relai.me();
    setMe(next);
    setStatus("signedIn");
  }, []);

  useEffect(() => {
    try {
      initRelai();
      void refreshMe();
    } catch (err) {
      setLastError(toError(err));
      setStatus("signedOut");
    }
  }, [refreshMe]);

  const sendCode = useCallback(async (email: string) => {
    setLastError(null);
    try {
      await getRelai().auth.startOtp(email.trim().toLowerCase());
    } catch (err) {
      setLastError(toError(err));
      throw err;
    }
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      setLastError(null);
      try {
        await getRelai().auth.verifyOtp(email.trim().toLowerCase(), code.trim());
        await refreshMe();
      } catch (err) {
        setLastError(toError(err));
        throw err;
      }
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    try {
      await getRelai().auth.signOut();
    } catch {
      getRelai().auth.clearSession();
    }
    setMe(null);
    setStatus("signedOut");
  }, []);

  const value = useMemo(
    () => ({
      status,
      me,
      sendCode,
      verifyCode,
      signOut,
      lastError,
      clearError: () => setLastError(null),
    }),
    [status, me, sendCode, verifyCode, signOut, lastError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
