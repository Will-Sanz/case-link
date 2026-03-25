import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { ResourceDetailRecord } from "@/types/resource-detail";

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined | boolean;
}) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="border-b border-slate-100 py-3.5 last:border-0">
      <dt className="text-xs font-medium text-slate-500">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-slate-900">{display}</dd>
    </div>
  );
}

function FlagRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
      <span className="text-slate-700">{label}</span>
      <Badge
        className={
          on
            ? "border-emerald-200/80 bg-emerald-50 text-emerald-900"
            : "border-slate-200 bg-white text-slate-500"
        }
      >
        {on ? "Yes" : "No"}
      </Badge>
    </div>
  );
}

export function ResourceDetailView({ r }: { r: ResourceDetailRecord }) {
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <Link
          href="/resources"
          className="text-sm font-medium text-blue-800 underline-offset-2 hover:text-blue-900 hover:underline"
        >
          ← Back to resources
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {r.program_name}
        </h1>
        <p className="mt-2 text-slate-600">{r.office_or_department}</p>
      </div>

      {r.description ? (
        <Card>
          <CardTitle>Description</CardTitle>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {r.description}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Primary contact</CardTitle>
          <dl className="mt-2">
            <Field label="Name" value={r.primary_contact_name} />
            <Field label="Title" value={r.primary_contact_title} />
            <Field label="Email" value={r.primary_contact_email} />
            <Field label="Phone" value={r.primary_contact_phone} />
          </dl>
        </Card>
        <Card>
          <CardTitle>Secondary contact</CardTitle>
          <dl className="mt-2">
            <Field label="Name" value={r.secondary_contact_name} />
            <Field label="Title" value={r.secondary_contact_title} />
            <Field label="Email" value={r.secondary_contact_email} />
            <Field label="Phone" value={r.secondary_contact_phone} />
          </dl>
        </Card>
      </div>

      <Card>
        <CardTitle>Partner fair & recruitment</CardTitle>
        <dl className="mt-2">
          <Field
            label="Invite to March Partner Fair"
            value={r.invite_march_partner_fair}
          />
          <Field label="Partner fair attended" value={r.partner_fair_attended} />
          <Field
            label="Recruit for grocery giveaways"
            value={r.recruit_for_grocery_giveaways}
          />
        </dl>
      </Card>

      <Card>
        <CardTitle>Services offered</CardTitle>
        <div className="mt-2 divide-y divide-slate-100">
          <FlagRow label="Tabling at events" on={r.tabling_at_events} />
          <FlagRow
            label="Promotional / informational materials"
            on={r.promotional_materials}
          />
          <FlagRow label="Educational workshops" on={r.educational_workshops} />
          <FlagRow
            label="Volunteer recruitment or support"
            on={r.volunteer_recruitment_support}
          />
        </div>
      </Card>

      {r.services_select_all ? (
        <Card>
          <CardTitle>Community school options (raw)</CardTitle>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {r.services_select_all}
          </p>
        </Card>
      ) : null}

      {r.additional_info ? (
        <Card>
          <CardTitle>Additional information</CardTitle>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {r.additional_info}
          </p>
        </Card>
      ) : null}

      {(r.tags?.length ?? 0) > 0 ? (
        <Card>
          <CardTitle>Tags</CardTitle>
          <div className="mt-4 flex flex-wrap gap-2">
            {(r.tags ?? []).map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
