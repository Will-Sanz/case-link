import { Card, CardTitle } from "@/components/ui/card";

export function PhasePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/80">
      <CardTitle className="text-base text-slate-700">{title}</CardTitle>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </Card>
  );
}
