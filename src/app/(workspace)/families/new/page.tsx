import { Card, CardTitle } from "@/components/ui/card";

export default function FamilyIntakePlaceholderPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">New family intake</h1>
      <Card>
        <CardTitle className="text-base">Coming in Phase 2</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          The structured intake flow (goals, barriers, household members) will
          live here. For now, use the resource directory to explore partner
          programs.
        </p>
      </Card>
    </div>
  );
}
