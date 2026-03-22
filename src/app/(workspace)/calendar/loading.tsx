export default function CalendarLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-96 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-10 w-32 animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 w-24 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
          <div className="min-h-[400px] animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
        </div>
        <aside className="w-full shrink-0 lg:w-80">
          <div className="sticky top-6 h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
        </aside>
      </div>
    </div>
  );
}
