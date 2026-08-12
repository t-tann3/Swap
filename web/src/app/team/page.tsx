"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useMarketplace } from "../../context/MarketplaceContext";
import { apiRequest } from "../../lib/api";
import type { PantryTeam } from "../../lib/types";

type TeamRow = {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "Invited" | "Accepted";
  role: string | null;
  kind: "member" | "invite";
  id: string;
};

export default function TeamPage() {
  const { profile, pantryMode, ready } = useMarketplace();
  const isSeller = profile?.roles.includes("seller") ?? false;
  const [team, setTeam] = useState<PantryTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const load = useCallback(async () => {
    const data = await apiRequest<PantryTeam>("/api/me/pantry", { auth: true });
    setTeam(data);
  }, []);

  useEffect(() => {
    if (!ready || !isSeller || !pantryMode) return;
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Failed to load team");
    });
  }, [ready, isSeller, pantryMode, load]);

  const isOwner = team?.role === "owner";

  const rows = useMemo<TeamRow[]>(() => {
    const accepted: TeamRow[] = (team?.members ?? []).map(m => ({
      key: `m-${m.userId}`,
      firstName: m.firstName ?? "",
      lastName: m.lastName ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
      status: "Accepted",
      role: m.role,
      kind: "member",
      id: m.userId,
    }));
    const invited: TeamRow[] = (team?.invites ?? []).map(inv => ({
      key: `i-${inv.id}`,
      firstName: inv.firstName ?? "",
      lastName: inv.lastName ?? "",
      email: inv.email,
      phone: inv.phone ?? "",
      status: "Invited",
      role: null,
      kind: "invite",
      id: inv.id,
    }));
    return [...accepted, ...invited];
  }, [team]);

  async function sendInvite() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiRequest("/api/me/pantry/invites", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          email: trimmedEmail,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setMsg(`${trimmedEmail} can join when they sign in with that email.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row: TeamRow) {
    setBusy(true);
    setError(null);
    try {
      if (row.kind === "member") {
        await apiRequest(`/api/me/pantry/members/${row.id}`, {
          method: "DELETE",
          auth: true,
        });
      } else {
        await apiRequest(`/api/me/pantry/invites/${row.id}`, {
          method: "DELETE",
          auth: true,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update team");
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
        <h1 className="text-lg font-semibold">Team</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Team management is available when pantry mode is on.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {isOwner
            ? "Invite staff by email. Members can stock, accept, and drop off — only you can invite."
            : team?.role === "member"
              ? "You are a member of this pantry."
              : "Your pantry team will appear here."}
        </p>
        {team?.pantry ? (
          <p className="mt-1 text-sm font-medium text-zinc-800">
            {team.pantry.name}
            {team.role ? ` · your role: ${team.role}` : null}
          </p>
        ) : null}
      </header>

      {isOwner ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
            Invite member
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm"
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm"
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm"
            />
            <input
              type="tel"
              placeholder="Phone number"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy || !email.trim()}
            onClick={() => void sendInvite()}
            className="mt-4 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "…" : "Invite"}
          </button>
        </section>
      ) : null}

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
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={isOwner ? 6 : 5}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No team members yet.
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr
                    key={row.key}
                    className="border-b border-zinc-50 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {row.firstName || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {row.lastName || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {row.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {row.phone || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                          row.status === "Accepted"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {row.status}
                        {row.role === "owner" ? " · owner" : ""}
                      </span>
                    </td>
                    {isOwner ? (
                      <td className="px-4 py-3 text-right">
                        {row.role === "owner" ? null : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeRow(row)}
                            className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                          >
                            {row.kind === "invite" ? "Revoke" : "Remove"}
                          </button>
                        )}
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
