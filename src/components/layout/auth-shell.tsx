import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#eef1f4] px-4 py-16">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm shadow-teal-900/20">
            CL
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {subtitle}
          </p>
        </div>
        <Card className="border-slate-200/80 p-6 shadow-md shadow-slate-900/[0.06]">
          {children}
        </Card>
        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
