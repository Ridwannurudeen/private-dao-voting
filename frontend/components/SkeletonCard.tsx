export function SkeletonCard() {
  return (
    <div className="panel p-6 animate-pulse">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-3 w-12" style={{ background: "var(--ink-3)" }} />
        <div className="h-3 w-16" style={{ background: "var(--ink-3)" }} />
        <div className="h-3 w-20" style={{ background: "var(--ink-3)" }} />
      </div>
      <div className="h-7 w-3/4 mb-3" style={{ background: "var(--ink-3)" }} />
      <div className="h-3 w-32 mb-6" style={{ background: "var(--ink-3)" }} />
      <div className="space-y-2 mb-6">
        <div className="h-3 w-full" style={{ background: "var(--ink-3)" }} />
        <div className="h-3 w-5/6" style={{ background: "var(--ink-3)" }} />
        <div className="h-3 w-2/3" style={{ background: "var(--ink-3)" }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-9" style={{ background: "var(--ink-3)" }} />
        <div className="h-9" style={{ background: "var(--ink-3)" }} />
        <div className="h-9" style={{ background: "var(--ink-3)" }} />
      </div>
    </div>
  );
}
