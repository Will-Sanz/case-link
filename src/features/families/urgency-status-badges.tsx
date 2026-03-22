import { Badge } from "@/components/ui/badge";

const urgencyClass: Record<string, string> = {
  low: "border-slate-200 bg-slate-100 text-slate-700",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  high: "border-amber-300 bg-amber-50 text-amber-900",
  crisis: "border-red-200 bg-red-50 text-red-800",
};

const statusClass: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  on_hold: "border-amber-200 bg-amber-50 text-amber-800",
  closed: "border-slate-200 bg-slate-100 text-slate-600",
};

export function UrgencyBadge({
  urgency,
}: {
  urgency: "low" | "medium" | "high" | "crisis" | null;
}) {
  if (!urgency) {
    return (
      <Badge className="border-slate-200 bg-slate-50 font-normal text-slate-500">
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
