"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import type { PantryPatronRoster } from "../../lib/types";

export default function MembersPage() {
  const { profile, pantryMode, ready } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [roster, setRoster] = useState<PantryPatronRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<PantryPatronRoster>("/api/me/pantry/patrons", {
      auth: true,
    });
    setRoster(data);
  }, []);

  useEffect(() => {
    if (!ready || !isSeller || !pantryMode) return;
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load members");
    });
  }, [ready, isSeller, pantryMode, load]);

  const isOwner = roster?.role === "owner";
  const enforceOn = roster?.pantry?.patronAllowlistEnabled ?? false;

  async function toggleEnforce(next: boolean) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiRequest("/api/me/pantry/patrons/settings", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ patronAllowlistEnabled: next }),
      });
      await load();
      setMsg(
        next
          ? "Only verified neighbors on this list can shop now."
          : "Member list is not enforced — any neighbor can shop.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update setting");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv(file: File) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const csv = await file.text();
      const result = await apiRequest<{
        added: number;
        updated: number;
        skipped: number;
      }>("/api/me/pantry/patrons/upload", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ csv }),
      });
      await load();
      setMsg(
        `Uploaded: ${result.added} added, ${result.updated} updated` +
          (result.skipped ? `, ${result.skipped} skipped` : "") +
          ".",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePatron(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/me/pantry/patrons/${id}`, {
        method: "DELETE",
        auth: true,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  if (!isSeller) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Pantry role required</h1>
      </div>
    );
  }

  if (!pantryMode) {
    return (
      <div className="rounded-xl bg-white p-6">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Member lists are available when pantry mode is on.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Upload verified neighbors by email. When enforcement is on, only
          matched emails can browse and check out from your pantry.
        </p>
        {roster?.pantry ? (
          <p className="mt-1 text-sm font-medium text-zinc-800">
            {roster.pantry.name}
          </p>
        ) : null}
      </header>

      {isOwner ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
                Restrict shopping
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {enforceOn
                  ? "On — only listed neighbors can shop."
                  : "Off — any neighbor can shop."}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleEnforce(!enforceOn)}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                enforceOn
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 bg-white text-zinc-900"
              }`}
            >
              {enforceOn ? "Enforcement on" : "Enforcement off"}
            </button>
          </div>

          <div className="mt-6 border-t border-zinc-100 pt-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
              Upload CSV
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Columns: email (required), first_name, last_name, phone.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void uploadCsv(file);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-3 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Choose CSV file"}
            </button>
          </div>
        </section>
      ) : (
        <p className="text-sm text-zinc-600">
          Only the pantry owner can upload the member list or change
          enforcement.
        </p>
      )}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-800">{msg}</p> : null}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">First name</th>
                <th className="px-4 py-3">Last name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                {isOwner ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {(roster?.patrons ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={isOwner ? 6 : 5}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No verified members uploaded yet.
                  </td>
                </tr>
              ) : (
                (roster?.patrons ?? []).map(row => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-50 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {row.firstName || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {row.lastName || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">{row.email}</td>
                    <td className="px-4 py-3 text-zinc-800">
                      {row.phone || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                          row.status === "matched"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {row.status === "matched" ? "Matched" : "Listed"}
                      </span>
                    </td>
                    {isOwner ? (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removePatron(row.id)}
                          className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
