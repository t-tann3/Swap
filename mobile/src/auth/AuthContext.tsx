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

import { getRelai, initRelai } from "../relai/client";
import {
  registerForPushNotifications,
  subscribePushTokenRefresh,
  unregisterPushNotifications,
} from "../push/notifications";

type AuthStatus = "booting" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  me: Me | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  lastError: { code?: string; message: string } | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toError(err: unknown): { code?: string; message: string } {
  if (err instanceof RelaiApiError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
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
    let cancelled = false;
    (async () => {
      try {
        await initRelai();
        if (cancelled) return;
        const relai = getRelai();
        if (relai.auth.isSignedIn) {
          await refreshMe();
        } else {
          setStatus("signedOut");
        }
      } catch (err) {
        if (!cancelled) {
          setLastError(toError(err));
          setStatus("signedOut");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  useEffect(() => {
    if (status !== "signedIn") return;
    void registerForPushNotifications().catch(() => {
      // Permission denied / simulator — app still works.
    });
    return subscribePushTokenRefresh();
  }, [status]);

  const sendCode = useCallback(async (email: string) => {
    setLastError(null);
    try {
      await getRelai().auth.startOtp(email.trim().toLowerCase());
    } catch (err) {
      const parsed = toError(err);
      setLastError(parsed);
      throw err;
    }
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      setLastError(null);
      try {
        await getRelai().auth.verifyOtp(
          email.trim().toLowerCase(),
          code.trim(),
        );
        await refreshMe();
      } catch (err) {
        const parsed = toError(err);
        setLastError(parsed);
        throw err;
      }
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    setLastError(null);
    await unregisterPushNotifications();
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
      refreshMe,
      lastError,
      clearError: () => setLastError(null),
    }),
    [status, me, sendCode, verifyCode, signOut, refreshMe, lastError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
