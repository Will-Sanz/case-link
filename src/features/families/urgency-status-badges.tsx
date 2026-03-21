import { Badge } from "@/components/ui/badge";

const urgencyClass: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-orange-100 text-orange-900",
  crisis: "bg-red-100 text-red-900",
};

const statusClass: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-900",
  on_hold: "bg-amber-100 text-amber-900",
  closed: "bg-slate-200 text-slate-700",
};

export function UrgencyBadge({
  urgency,
}: {
  urgency: "low" | "medium" | "high" | "crisis" | null;
}) {
  if (!urgency) {
    return <Badge className="bg-slate-50 text-slate-500">Urgency not set</Badge>;
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
  return (
    <Badge className={statusClass[status] ?? ""}>{label}</Badge>
  );
}
