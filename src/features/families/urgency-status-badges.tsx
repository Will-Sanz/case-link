import { Badge } from "@/components/ui/badge";

const urgencyClass: Record<string, string> = {
  low: "border-slate-200 bg-slate-100 text-slate-800",
  medium: "border-amber-200/80 bg-amber-50 text-amber-950",
  high: "border-orange-200/80 bg-orange-50 text-orange-950",
  crisis: "border-red-200/80 bg-red-50 text-red-950",
};

const statusClass: Record<string, string> = {
  active: "border-emerald-200/80 bg-emerald-50 text-emerald-950",
  on_hold: "border-amber-200/80 bg-amber-50 text-amber-950",
  closed: "border-slate-200 bg-slate-100 text-slate-700",
};

export function UrgencyBadge({
  urgency,
}: {
  urgency: "low" | "medium" | "high" | "crisis" | null;
}) {
  if (!urgency) {
    return (
      <Badge className="border-slate-200 bg-white font-normal text-slate-500">
        Urgency not set
      </Badge>
    );
  }
  return (
    <Badge className={urgencyClass[urgency] ?? ""}>
      {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </Badge>
  );
}

export function StatusBadge({
  status,
}: {
  status: "active" | "on_hold" | "closed";
}) {
  const label = status.replace(/_/g, " ");
  return <Badge className={statusClass[status] ?? ""}>{label}</Badge>;
}
