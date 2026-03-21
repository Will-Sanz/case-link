import { Card, CardTitle } from "@/components/ui/card";

export function PhasePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-slate-300/90 bg-slate-50/50">
      <CardTitle className="text-slate-800">{title}</CardTitle>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
    </Card>
  );
}
