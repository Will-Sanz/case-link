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
    <div className="flex min-h-full flex-col items-center justify-center bg-[#f4f6f8] px-4 py-16">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/90 text-sm font-semibold text-white">
            CL
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            {title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            {subtitle}
          </p>
        </div>
        <Card className="p-6">
          {children}
        </Card>
        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
