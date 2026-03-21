"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  addManualResourceMatch,
  linkResourceToStep,
  runResourceMatching,
  searchResourcesAction,
  unlinkResourceFromStep,
  updateResourceMatchStatus,
} from "@/app/actions/resource-matches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/section-header";
import type { PlanWithSteps, ResourceMatchRow } from "@/types/family";

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

const MAX_VISIBLE_MATCHES = 10;

export function ResourceMatchesPanel({
  familyId,
  matches,
  plan,
}: {
  familyId: string;
  matches: ResourceMatchRow[];
  plan: PlanWithSteps | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<
    { id: string; program_name: string; office_or_department: string }[]
  >([]);
  const [showAllMatches, setShowAllMatches] = useState(false);

  const actionableMatches = useMemo(
    () => matches.filter((m) => m.status !== "dismissed"),
    [matches],
  );

  const visibleMatches = useMemo(() => {
    if (showAllMatches) return actionableMatches;
    return actionableMatches.slice(0, MAX_VISIBLE_MATCHES);
  }, [actionableMatches, showAllMatches]);

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

  function doLinkToStep(matchId: string, stepId: string) {
    setError(null);
    startTransition(async () => {
      const r = await linkResourceToStep({ matchId, familyId, stepId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function doUnlink(matchId: string) {
    setError(null);
    startTransition(async () => {
      const r = await unlinkResourceFromStep({ matchId, familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const steps = plan?.steps ?? [];

  return (
    <Card>
      <SectionHeader
        title="Matched resources"
        description="Top matches are ranked by the matching engine (goals, barriers, narrative). The list shows the highest-priority suggestions first; accept or dismiss to triage."
        actions={
          <Button
            type="button"
            onClick={runMatch}
            disabled={pending}
            variant="secondary"
          >
            {pending ? "Working…" : "Run / refresh matching"}
          </Button>
        }
      />

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50/90 px-3 py-2.5 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {matches.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-600">
          No matches yet. Run matching to populate suggestions from the
          resource directory.
        </p>
      ) : actionableMatches.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-600">
          All matches are dismissed. Run matching again for fresh suggestions,
          or add a program manually below.
        </p>
      ) : (
        <>
          {!showAllMatches &&
          actionableMatches.length > MAX_VISIBLE_MATCHES ? (
            <p className="mt-5 text-sm text-slate-600">
              Showing the top {MAX_VISIBLE_MATCHES} matches by score. Use
              &quot;Show all&quot; to see the full list.
            </p>
          ) : null}
          <ul className="mt-4 space-y-4">
          {visibleMatches.map((m) => {
            const r = m.resource;
            return (
              <li
                key={m.id}
                className="rounded-xl border border-slate-200/80 bg-slate-50/30 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {r ? (
                      <>
                        <Link
                          href={`/resources/${r.id}`}
                          className="font-semibold text-slate-900 underline-offset-2 hover:text-teal-900 hover:underline"
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
                ) : m.status === "accepted" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {m.plan_step_id ? (
                      <>
                        <Badge className="bg-teal-100 text-teal-900">
                          Used in plan
                        </Badge>
                        {steps.find((s) => s.id === m.plan_step_id) ? (
                          <Link
                            href={`#step-${m.plan_step_id}`}
                            className="text-xs text-teal-700 hover:underline"
                          >
                            → {steps.find((s) => s.id === m.plan_step_id)?.title}
                          </Link>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-slate-600"
                          onClick={() => doUnlink(m.id)}
                          disabled={pending}
                        >
                          Unlink
                        </Button>
                      </>
                    ) : steps.length > 0 ? (
                      <select
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/25"
                        value=""
                        onChange={(e) => {
                          const stepId = e.target.value;
                          if (stepId) doLinkToStep(m.id, stepId);
                          e.target.value = "";
                        }}
                        disabled={pending}
                      >
                        <option value="">Add to plan…</option>
                        {steps.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title} ({s.phase}-day)
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          </ul>
          {actionableMatches.length > MAX_VISIBLE_MATCHES ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="ghost"
                className="text-sm"
                onClick={() => setShowAllMatches((v) => !v)}
              >
                {showAllMatches
                  ? "Show top matches only"
                  : `Show all ${actionableMatches.length} matches`}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-8 border-t border-slate-200/80 pt-6">
        <CardTitle className="text-base">Add resource manually</CardTitle>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Search the directory and add as <strong>accepted</strong> (updates
          if this program was already matched).
        </p>
        <form onSubmit={doSearch} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
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
          <ul className="mt-4 space-y-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
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
