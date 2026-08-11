"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../../context/AuthContext";

export default function LoginPage() {
  const { status, sendCode, verifyCode, lastError, clearError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signedIn") router.replace("/browse");
  }, [status, router]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    clearError();
    setBusy(true);
    try {
      await sendCode(email);
      setStep("code");
    } catch {
      // lastError set
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (code.trim().length < 6 || busy) return;
    clearError();
    setBusy(true);
    try {
      await verifyCode(email, code);
      router.replace("/browse");
    } catch {
      // lastError set
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Swap</h1>
        <p className="mt-2 text-zinc-600">
          {step === "email"
            ? "Sign in with your email"
            : `Enter the code sent to ${email}`}
        </p>

        {step === "email" ? (
          <form onSubmit={onSend} className="mt-6 space-y-3">
            <input
              className="w-full rounded-xl border border-zinc-200 px-4 py-3"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
            />
            {lastError ? (
              <p className="text-sm text-red-600">
                {lastError.code ? `[${lastError.code}] ` : ""}
                {lastError.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
            <p className="text-xs text-zinc-500">
              Sandbox tip: use a Relai portal test end-user email and its fixed
              code.
            </p>
          </form>
        ) : (
          <form onSubmit={onVerify} className="mt-6 space-y-3">
            <input
              className="w-full rounded-xl border border-zinc-200 px-4 py-3 text-center text-xl tracking-[0.3em]"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={busy}
            />
            {lastError ? (
              <p className="text-sm text-red-600">
                {lastError.code ? `[${lastError.code}] ` : ""}
                {lastError.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              className="w-full text-sm font-medium text-zinc-700"
              onClick={() => {
                setStep("email");
                clearError();
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
