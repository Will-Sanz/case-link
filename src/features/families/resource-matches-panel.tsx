"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addManualResourceMatch,
  runResourceMatching,
  searchResourcesAction,
  updateResourceMatchStatus,
} from "@/app/actions/resource-matches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResourceMatchRow } from "@/types/family";

function flagSummary(r: NonNullable<ResourceMatchRow["resource"]>): string {
  const parts: string[] = [];
  if (r.tabling_at_events) parts.push("Tabling");
  if (r.promotional_materials) parts.push("Materials");
  if (r.educational_workshops) parts.push("Workshops");
  if (r.volunteer_recruitment_support) parts.push("Volunteers");
  if (r.recruit_for_grocery_giveaways) parts.push("Grocery");
  return parts.length ? parts.join(" · ") : "—";
}

function MatchStatusBadge({ status }: { status: ResourceMatchRow["status"] }) {
  const cls =
    status === "accepted"
      ? "bg-emerald-100 text-emerald-900"
      : status === "dismissed"
        ? "bg-slate-200 text-slate-600"
        : "bg-amber-100 text-amber-900";
  return <Badge className={cls}>{status}</Badge>;
}

export function ResourceMatchesPanel({
  familyId,
  matches,
}: {
  familyId: string;
  matches: ResourceMatchRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<
    { id: string; program_name: string; office_or_department: string }[]
  >([]);

  function runMatch() {
    setError(null);
    startTransition(async () => {
      const r = await runResourceMatching({ familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function setStatus(matchId: string, status: "accepted" | "dismissed") {
    setError(null);
    startTransition(async () => {
      const r = await updateResourceMatchStatus({ matchId, familyId, status });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSearchBusy(true);
    try {
      const r = await searchResourcesAction({ q: searchQ });
      if (!r.ok) {
        setError(r.error);
        setSearchResults([]);
        return;
      }
      const alreadyLinked = new Set(
        matches.filter((m) => m.status !== "dismissed").map((m) => m.resource_id),
      );
      setSearchResults(r.items.filter((row) => !alreadyLinked.has(row.id)));
    } finally {
      setSearchBusy(false);
    }
  }

  function addManual(resourceId: string) {
    setError(null);
    startTransition(async () => {
      const r = await addManualResourceMatch({ familyId, resourceId });
      if (!r.ok) setError(r.error);
      else {
        setSearchResults((prev) => prev.filter((x) => x.id !== resourceId));
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <CardTitle className="text-base">Matched resources</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            Ranked from goals, barriers, and family narrative (deterministic — no
            AI). Accept or dismiss suggestions; dismissed programs stay hidden
            on refresh runs.
          </p>
        </div>
        <Button
          type="button"
          onClick={runMatch}
          disabled={pending}
          variant="secondary"
        >
          {pending ? "Working…" : "Run / refresh matching"}
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No matches yet. Run matching to populate suggestions from the
          resource directory.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {matches.map((m) => {
            const r = m.resource;
            return (
              <li
                key={m.id}
                className="border-b border-slate-100 pb-4 last:border-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {r ? (
                      <>
                        <Link
                          href={`/resources/${r.id}`}
                          className="font-semibold text-slate-900 hover:underline"
                        >
                          {r.program_name}
                        </Link>
                        <p className="text-sm text-slate-600">
                          {r.office_or_department}
                        </p>
                        {r.category ? (
                          <Badge className="mt-1">{r.category}</Badge>
                        ) : null}
                      </>
                    ) : (
                      <p className="font-medium text-slate-800">
                        Unknown resource{" "}
                        <span className="font-mono text-xs">{m.resource_id}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MatchStatusBadge status={m.status} />
                    <span className="text-xs text-slate-500">
                      Score {Math.round(m.score)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-700">{m.match_reason}</p>
                {r ? (
                  <div className="mt-2 text-sm text-slate-600">
                    {r.primary_contact_name ? (
                      <p>{r.primary_contact_name}</p>
                    ) : null}
                    {r.primary_contact_email ? (
                      <p>{r.primary_contact_email}</p>
                    ) : null}
                    {r.primary_contact_phone ? (
                      <p className="tabular-nums">{r.primary_contact_phone}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      Services: {flagSummary(r)}
                    </p>
                  </div>
                ) : null}
                {m.status === "suggested" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="py-1.5 px-3 text-xs"
                      onClick={() => setStatus(m.id, "accepted")}
                      disabled={pending}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      className="py-1.5 px-3 text-xs"
                      variant="secondary"
                      onClick={() => setStatus(m.id, "dismissed")}
                      disabled={pending}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 border-t border-slate-100 pt-6">
        <CardTitle className="text-base">Add resource manually</CardTitle>
        <p className="mt-1 text-sm text-slate-600">
          Search the directory and add as <strong>accepted</strong> (updates
          if this program was already matched).
        </p>
        <form onSubmit={doSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="res-search" className="sr-only">
              Search resources
            </Label>
            <Input
              id="res-search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Program or organization…"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={searchBusy}>
            {searchBusy ? "Searching…" : "Search"}
          </Button>
        </form>
        {searchResults.length > 0 ? (
          <ul className="mt-3 space-y-2 border border-slate-100 rounded-lg p-3">
            {searchResults.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div>
                  <span className="font-medium text-slate-900">
                    {row.program_name}
                  </span>
                  <span className="text-slate-600">
                    {" "}
                    — {row.office_or_department}
                  </span>
                </div>
                <Button
                  type="button"
                  className="py-1.5 px-3 text-xs"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => addManual(row.id)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
