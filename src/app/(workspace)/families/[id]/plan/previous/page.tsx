import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { actionTargetDate, actionUiStatus, actionUserNotes } from "@/lib/domain/plan/action-state";
import type { PlanWithSteps } from "@/types/family";

export default async function PreviousPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_previous_reviewed_plan", { p_family_id: id });
  if (error) throw new Error("Could not load the previous plan. Try again.");
  if (!data) notFound();
  const plan = data as PlanWithSteps;
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href={`/families/${id}/plan`} className="text-sm underline">Back to current draft</Link>
      <header>
        <h1 className="text-2xl font-semibold">Previous reviewed plan · Version {plan.version}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          This saved version is available for reference while you prepare the current plan.
          Case information may have changed since its review. Edit and review the current plan before downloading a new PDF.
        </p>
      </header>
      {plan.steps.map(step => (
        <section key={step.id} className="space-y-3 rounded-lg border border-[var(--color-rule)] p-5">
          <h2 className="text-lg font-semibold">{step.details?.stage_goal || step.title}</h2>
          <p>{step.title}</p>
          <p className="whitespace-pre-wrap text-sm">{step.description}</p>
          {step.details?.expected_outcome ? <p className="text-sm">Expected result: {step.details.expected_outcome}</p> : null}
          <ol className="space-y-4">
            {(step.action_items ?? []).map(action => (
              <li key={action.id} className="border-t border-[var(--color-rule)] pt-3 text-sm">
                <p className="font-semibold">{action.title}</p>
                <p>{actionUiStatus(action).replaceAll("_", " ")} · {action.status === "blocked" ? "Follow up" : "Target"}: {actionTargetDate(action) ?? "No date recorded"}</p>
                {action.description ? <p className="whitespace-pre-wrap">{action.description}</p> : null}
                {actionUserNotes(action.notes) ? <p className="whitespace-pre-wrap">Notes: {actionUserNotes(action.notes)}</p> : null}
                {action.outcome ? <p className="whitespace-pre-wrap">Outcome: {action.outcome}</p> : null}
              </li>
            ))}
          </ol>
          {step.details?.required_documents?.length ? <p className="text-sm">Documents: {step.details.required_documents.join("; ")}</p> : null}
          {step.details?.contacts?.map((contact, index) => <p key={index} className="text-sm">{[contact.name, contact.phone, contact.email, contact.notes].filter(Boolean).join(" · ")}</p>)}
        </section>
      ))}
    </div>
  );
}
